import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile, open, link, lstat } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { HostStateFile, bindHostStateMutations, hostDirectoryEntries } from '../host-state-file.ts';
import type {
  BackboneBlocks,
  BackboneConclusionInput,
  BackboneProposalInput,
  DesignReviewSummary,
  AttentionItem,
  AnchoredAttentionItem,
  DesignPerspective,
  ImplementationState,
  ImplementationStateUpdate,
} from './proposal.ts';
import {
  validateBackboneProposal,
  validateDesignReviewSummary,
  validateImplementationStateUpdates,
} from './proposal.ts';
import { normalizeImplementationState } from './schema-primitives.ts';
import { LEGACY_V1_POLICY, parsePolicySnapshot, type PolicySnapshot } from '../workflow/policy.ts';
import {
  applyImplementationReviewFindings,
  type ImplementationReviewFinding,
  type ImplementationStateReconciliation,
} from '../implementation-review.ts';

export type BackboneBlockName = keyof BackboneBlocks;

const blockFiles: Record<BackboneBlockName, string> = {
  useCases: 'use-case.json',
  contract: 'contract.json',
  controlFlows: 'flow.json',
  guiSketches: 'gui.json',
  systemStacks: 'system.json',
};
const legacyImplementationProgressFile = 'implementation-progress.json';

export async function renameWithRetry(from: string, to: string, policy: PolicySnapshot = LEGACY_V1_POLICY): Promise<void> {
  const limits = parsePolicySnapshot(policy).values.io;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EBUSY', 'EACCES', 'EPERM'].includes(code ?? '') || attempt >= limits.renameRetries) {
        throw error;
      }
      await delay(Math.min(limits.renameInitialDelayMs * (2 ** attempt), limits.renameMaximumDelayMs));
    }
  }
}

const blockPerspectives: Record<BackboneBlockName, DesignPerspective> = {
  useCases: 'use-case',
  contract: 'contract',
  controlFlows: 'flow',
  guiSketches: 'gui',
  systemStacks: 'system',
};

function aggregateImplementationState(
  states: ImplementationState[],
): ImplementationState {
  if (states.length === 0 || states.every((state) => state === 'planned')) {
    return 'planned';
  }
  if (states.every((state) => state === 'verified')) {
    return 'verified';
  }
  if (states.every((state) => state === 'implemented' || state === 'verified')) {
    return 'implemented';
  }
  return 'in-progress';
}

export interface PersistedBackboneProposal {
  id: string;
  requestId: string;
  proposedAt: string;
  input: BackboneProposalInput;
  artifactPath: string;
  notes: string[];
  reviewSummaries: DesignReviewSummaryRecord[];
}

export interface DesignReviewSummaryRecord extends DesignReviewSummary {
  proposalId: string;
  reviewedAt: string;
  kind: 'initial' | 'revision';
}

interface BackboneManifest {
  schemaVersion: 'living-design/v7';
  id: string;
  requestId: string;
  proposedAt: string;
  goal: string;
  summary: string;
  aspects: BackboneProposalInput['aspects'];
  blocks: Record<BackboneBlockName, string>;
  notes: string[];
  reviewSummaries?: DesignReviewSummaryRecord[];
}

export interface BackboneApplicationPlan {
  id: string;
  proposedAt: string;
  conclusion: BackboneConclusionInput;
}

interface LegacyV6Manifest extends Omit<BackboneManifest, 'schemaVersion'> {
  schemaVersion: 'living-design/v6';
}

interface LegacyV5Manifest extends Omit<BackboneManifest, 'schemaVersion'> {
  schemaVersion: 'living-design/v5';
}

interface LegacyV4Manifest extends Omit<BackboneManifest, 'schemaVersion'> {
  schemaVersion: 'living-design/v4';
}

interface LegacyV3Manifest extends Omit<BackboneManifest, 'schemaVersion'> {
  schemaVersion: 'living-design/v3';
}

interface LegacyCanonicalManifest {
  schemaVersion: 'living-design/v1' | 'living-design/v2';
  id: string;
  requestId: string;
  proposedAt: string;
  goal: string;
  summary: string;
  aspects: BackboneProposalInput['aspects'];
  decisions: AnchoredAttentionItem[];
  blocks: Record<BackboneBlockName, string>;
  attentionCandidates: Record<BackboneBlockName, string>;
  attentionDispositions: Record<BackboneBlockName, string>;
  notes: string[];
  elementStates?: string;
}

interface LegacyDesignElementState {
  perspective: DesignPerspective;
  elementId: string;
  status: 'designed' | 'completed';
}

interface LegacyBackboneManifest {
  id: string;
  requestId: string;
  proposedAt: string;
  goal: string;
  summary: string;
  aspects: BackboneProposalInput['aspects'];
  decisions: AnchoredAttentionItem[];
  blocks: Record<BackboneBlockName, string>;
}

export class BackboneArtifactStore {
  readonly #workspace: string;
  readonly #designDirectory: string;
  readonly #stagingRoot: string;
  readonly #projectionOnly: boolean;

  constructor(workspace: string, options: { projectionOnly?: boolean } = {}) {
    this.#workspace = workspace;
    const root = join(workspace, '.tandem', 'living-canvas');
    this.#designDirectory = join(root, 'design');
    this.#stagingRoot = join(root, '.staging');
    this.#projectionOnly = options.projectionOnly ?? false;
    if (!this.#projectionOnly) bindHostStateMutations(this, this.#file(this.#manifestPath()),
      ['writeBlock', 'beginRevision', 'loadCurrent', 'updateImplementationStates', 'addImplementationAttention', 'applyImplementationReview', 'discard'],
      async () => undefined);
  }

  #file(path: string): HostStateFile {
    return new HostStateFile(this.#workspace, path, undefined, {
      artifact: basename(dirname(path)) === 'blocks' || !path.endsWith('.json'),
      text: !path.endsWith('.json'),
    });
  }

  async #readText(path: string): Promise<string> {
    if (this.#projectionOnly) return readFile(path, 'utf8');
    const content = await this.#file(path).read();
    if (content === undefined) throw Object.assign(new Error('Design state is absent.'), { code: 'ENOENT' });
    return content;
  }

  async materializeReviewSnapshot(expectedId: string): Promise<string> {
    return this.#file(this.#manifestPath()).inspect(async () => {
      const current = await this.inspectCurrent();
      if (!current || current.id !== expectedId) throw new Error('The review Design changed before snapshot materialization.');
      const images: Record<string, string> = { 'manifest.json': await this.#readText(this.#manifestPath()) };
      for (const file of Object.values(blockFiles)) images[join('blocks', file)] = await this.#readText(join(this.#designDirectory, 'blocks', file));
      const digest = createHash('sha256').update(JSON.stringify(images)).digest('hex');
      const directory = join(this.#designDirectory, '.snapshots', digest);
      for (const path of [join(this.#workspace, '.tandem'), join(this.#workspace, '.tandem', 'living-canvas'),
        this.#designDirectory, join(this.#designDirectory, '.snapshots'), directory, join(directory, 'blocks')]) {
        await mkdir(path, { recursive: true });
        const info = await lstat(path);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Review snapshot directory is aliased.');
      }
      for (const [name, content] of Object.entries(images)) {
        const target = join(directory, name), temporary = `${target}.${randomUUID()}.tmp`;
        await mkdir(dirname(target), { recursive: true });
        const handle = await open(temporary, 'wx');
        try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
        try { await link(temporary, target); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          const info = await lstat(target);
          if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || await readFile(target, 'utf8') !== content) {
            throw new Error('Immutable review Design snapshot changed.');
          }
        } finally { await rm(temporary, { force: true }); }
      }
      return relative(this.#workspace, join(directory, 'manifest.json'));
    });
  }

  async #removeFile(path: string): Promise<void> {
    if (this.#projectionOnly) { await rm(path, { force: true }); return; }
    const file = this.#file(path);
    await file.run('remove-design-state', () => file.write('remove-design-state', null));
  }

  async #removeTree(path: string): Promise<void> {
    if (this.#projectionOnly) { await rm(path, { recursive: true, force: true }); return; }
    for (const name of await hostDirectoryEntries(this.#workspace, path)) {
      const child = join(path, name);
      if (name.endsWith('.json') || name.endsWith('.md')) await this.#removeFile(child);
      else await this.#removeTree(child);
    }
  }

  async writeBlock<TName extends BackboneBlockName>(
    runId: string,
    name: TName,
    value: BackboneBlocks[TName],
  ): Promise<{ blockPath: string }> {
    const path = join(this.#runDirectory(runId), 'blocks', blockFiles[name]);
    let previousValue: unknown;
    try {
      previousValue = await this.#readJson<unknown>(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    const persistedValue = name === 'useCases'
      ? this.#withUseCaseImplementationStates(
          value as BackboneBlocks['useCases'],
          previousValue as BackboneBlocks['useCases'] | undefined,
        )
      : structuredClone(value);
    if (name !== 'useCases') {
      this.#removeAllImplementationStates(persistedValue);
    }
    await this.#writeJson(path, persistedValue);
    return { blockPath: relative(this.#workspace, path) };
  }

  async beginRevision(runId: string, previousArtifactPath: string): Promise<string> {
    const manifestPath = join(this.#workspace, previousArtifactPath);
    const manifest = manifestPath === this.#manifestPath()
      ? await this.#readCurrentManifest()
      : await this.#readJson<BackboneManifest>(manifestPath);
    const manifestDirectory = dirname(manifestPath);
    for (const name of Object.keys(blockFiles) as BackboneBlockName[]) {
      const blockLink = manifest.blocks?.[name];
      if (!blockLink) {
        throw new Error(`Previous proposal is missing the ${name} artifact link.`);
      }
      const block = await this.#readJson<unknown>(join(manifestDirectory, blockLink));
      await this.#writeJson(
        join(this.#runDirectory(runId), 'blocks', blockFiles[name]),
        block,
      );
    }
    return manifest.id;
  }

  async stagedBlocks(runId: string): Promise<BackboneBlockName[]> {
    const staged: BackboneBlockName[] = [];
    for (const name of Object.keys(blockFiles) as BackboneBlockName[]) {
      try {
        await this.#readText(
          join(this.#runDirectory(runId), 'blocks', blockFiles[name]),
        );
        staged.push(name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }
    return staged;
  }

  async conclude(
    runId: string,
    requestId: string,
    conclusion: BackboneConclusionInput,
    previousProposalId?: string,
    onApplying?: (application: BackboneApplicationPlan) => Promise<void>,
    savedApplication?: BackboneApplicationPlan,
  ): Promise<PersistedBackboneProposal> {
    const blocks = await this.#readBlocks(runId);
    const previousManifest = previousProposalId
      ? await this.#readCurrentManifest()
      : undefined;
    if (previousProposalId && previousManifest?.id !== previousProposalId) {
      throw new Error(
        `Revision baseline ${previousProposalId} does not match ${previousManifest?.id}.`,
      );
    }
    const importedNotes = previousManifest
      ? await this.#consolidateLegacyChanges(previousManifest.notes)
      : [];
    const turnNotes = [...new Set(conclusion.notes?.length
      ? conclusion.notes
      : [conclusion.summary])];
    const inheritedNotes = [
      ...(previousManifest?.notes ?? []),
      ...importedNotes,
    ];
    const notes = [...new Set([
      ...inheritedNotes,
      ...turnNotes,
    ])];
    const input: BackboneProposalInput = {
      goal: conclusion.goal,
      summary: conclusion.summary,
      aspects: conclusion.aspects,
      ...blocks,
    };
    validateBackboneProposal(input);
    if (conclusion.reviewSummary) {
      validateDesignReviewSummary(conclusion.reviewSummary, blocks);
    }
    const application = savedApplication ?? {
      id: randomUUID(),
      proposedAt: new Date().toISOString(),
      conclusion: structuredClone(conclusion),
    };
    const { id, proposedAt } = application;
    const reviewSummary = conclusion.reviewSummary
      ? {
          ...conclusion.reviewSummary,
          proposalId: id,
          reviewedAt: proposedAt,
          kind: previousManifest ? 'revision' as const : 'initial' as const,
        }
      : undefined;
    const reviewSummaries = [
      ...(previousManifest?.reviewSummaries ?? []),
      ...(reviewSummary ? [reviewSummary] : []),
    ];
    const artifactPath = relative(this.#workspace, this.#manifestPath());
    await onApplying?.(application);
    const promote = async () => {
    let currentManifest: string | undefined;
    try { currentManifest = await this.#readText(this.#manifestPath()); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (previousProposalId) {
      if (currentManifest === undefined || JSON.parse(currentManifest).id !== previousProposalId) throw new Error('Design revision changed before promotion.');
    } else if (currentManifest !== undefined) throw new Error('A current Design already exists; use an explicit revision.');
    if (JSON.stringify(await this.#readBlocks(runId)) !== JSON.stringify(blocks)) throw new Error('Staged Design changed before promotion.');
    for (const name of Object.keys(blockFiles) as BackboneBlockName[]) {
      await this.#writeJson(
        join(this.#designDirectory, 'blocks', blockFiles[name]),
        blocks[name],
      );
    }
    await this.#removeFile(join(this.#designDirectory, 'element-states.json'));
    await this.#removeTree(join(this.#designDirectory, 'attention-candidates'));
    await this.#removeTree(join(this.#designDirectory, 'attention-dispositions'));
    if (previousManifest) {
      await this.#appendNotes(proposedAt, turnNotes, proposedAt, id, inheritedNotes);
    } else {
      await this.#writeInitialNotes(proposedAt, turnNotes);
    }
    await this.#removeFile(join(this.#designDirectory, 'changes.md'));
    await this.#writeJson(this.#manifestPath(), {
      schemaVersion: 'living-design/v7',
      id,
      requestId,
      proposedAt,
      goal: conclusion.goal,
      summary: conclusion.summary,
      aspects: conclusion.aspects,
      blocks: Object.fromEntries(
        Object.entries(blockFiles).map(([name, file]) => [
          name,
          join('blocks', file),
        ]),
      ) as Record<BackboneBlockName, string>,
      notes,
      reviewSummaries,
    } satisfies BackboneManifest);
    await this.#removeFile(this.#legacyImplementationProgressPath());
    await this.discard(runId);
    return {
      id,
      requestId,
      proposedAt,
      input,
      artifactPath,
      notes,
      reviewSummaries,
    };
    };
    return this.#projectionOnly ? promote() : this.#file(this.#manifestPath()).run('promote-design', promote);
  }

  async inspectCurrent(): Promise<PersistedBackboneProposal | undefined> {
    let manifest: BackboneManifest;
    try { manifest = await this.#readJson<BackboneManifest>(this.#manifestPath()); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    if (manifest.schemaVersion !== 'living-design/v7') {
      throw new Error('Read-only design inspection requires a current v7 publication; migrate explicitly.');
    }
    for (const [name, file] of Object.entries(blockFiles)) {
      const link = manifest.blocks?.[name as BackboneBlockName];
      if (typeof link !== 'string' || link.replaceAll('\\', '/') !== `blocks/${file}`) {
        throw new Error('Read-only design inspection rejects non-canonical block paths.');
      }
    }
    const input: BackboneProposalInput = {
      goal: manifest.goal, summary: manifest.summary, aspects: manifest.aspects,
      ...await this.#readManifestBlocks(manifest),
    };
    validateBackboneProposal(input);
    if (JSON.stringify(await this.#readJson(this.#manifestPath())) !== JSON.stringify(manifest)) {
      throw new Error('Design publication changed during read-only inspection.');
    }
    return {
      id: manifest.id, requestId: manifest.requestId, proposedAt: manifest.proposedAt, input,
      artifactPath: relative(this.#workspace, this.#manifestPath()),
      notes: manifest.notes, reviewSummaries: manifest.reviewSummaries ?? [],
    };
  }

  async loadCurrent(): Promise<PersistedBackboneProposal | undefined> {
    let manifest: BackboneManifest;
    try {
      manifest = await this.#readCurrentManifest();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const migrated = await this.#migrateLegacyCurrent();
        await this.#removeFile(this.#legacyImplementationProgressPath());
        return migrated;
      }
      throw error;
    }
    const importedNotes = await this.#consolidateLegacyChanges(manifest.notes);
    const notes = [...new Set([...manifest.notes, ...importedNotes])];
    if (notes.length !== manifest.notes.length) {
      manifest = {
        ...manifest,
        notes,
      };
      await this.#writeJson(this.#manifestPath(), manifest);
    }
    const blocks = await this.#readManifestBlocks(manifest);
    if (this.#normalizeLegacyUseCaseStates(blocks.useCases)) {
      await this.#writeJson(
        join(this.#designDirectory, manifest.blocks.useCases),
        blocks.useCases,
      );
    }
    const input: BackboneProposalInput = {
      goal: manifest.goal,
      summary: manifest.summary,
      aspects: manifest.aspects,
      ...blocks,
    };
    validateBackboneProposal(input);
    await this.#removeFile(this.#legacyImplementationProgressPath());
    return {
      id: manifest.id,
      requestId: manifest.requestId,
      proposedAt: manifest.proposedAt,
      input,
      artifactPath: relative(this.#workspace, this.#manifestPath()),
      notes: manifest.notes,
      reviewSummaries: manifest.reviewSummaries ?? [],
    };
  }

  async updateImplementationStates(
    updates: ImplementationStateUpdate[],
  ): Promise<BackboneProposalInput> {
    const current = await this.loadCurrent();
    if (!current) {
      throw new Error('No living design is available to update.');
    }
    validateImplementationStateUpdates(updates, current.input);
    const blocks: BackboneBlocks = structuredClone({
      useCases: current.input.useCases,
      contract: current.input.contract,
      controlFlows: current.input.controlFlows,
      guiSketches: current.input.guiSketches,
      systemStacks: current.input.systemStacks,
    });
    const changedBlocks = new Set<BackboneBlockName>();
    for (const update of updates) {
      const blockName = this.#blockForPerspective(update.perspective);
      const matches = this.#setImplementationState(
        blocks[blockName],
        update.elementId,
        update.implementationState,
      );
      if (matches !== 1) {
        throw new Error(
          `Expected one ${update.perspective} element "${update.elementId}", found ${matches}.`,
        );
      }
      changedBlocks.add(blockName);
    }
    const input: BackboneProposalInput = {
      ...current.input,
      ...blocks,
    };
    validateBackboneProposal(input);
    await this.#replaceCanonicalBlocks(input, changedBlocks);
    return input;
  }

  async addImplementationAttention(
    findings: ImplementationReviewFinding[],
  ): Promise<{
    input: BackboneProposalInput;
    cleanupWarning?: string;
  }> {
    const current = await this.loadCurrent();
    if (!current) {
      throw new Error('No living design is available to update.');
    }
    const updated = applyImplementationReviewFindings(current.input, findings);
    const cleanupWarning = await this.#replaceCanonicalBlocks(
      updated.input,
      updated.changedBlocks,
    );
    return {
      input: updated.input,
      ...(cleanupWarning ? { cleanupWarning } : {}),
    };
  }

  async applyImplementationReview(
    findings: ImplementationReviewFinding[],
    stateUpdates: ImplementationStateReconciliation[],
  ): Promise<{
    input: BackboneProposalInput;
    cleanupWarning?: string;
  }> {
    const current = await this.loadCurrent();
    if (!current) {
      throw new Error('No living design is available to update.');
    }
    const withFindings = applyImplementationReviewFindings(current.input, findings);
    const blocks: BackboneBlocks = structuredClone({
      useCases: withFindings.input.useCases,
      contract: withFindings.input.contract,
      controlFlows: withFindings.input.controlFlows,
      guiSketches: withFindings.input.guiSketches,
      systemStacks: withFindings.input.systemStacks,
    });
    const updates: ImplementationStateUpdate[] = stateUpdates.map((update) => ({
      perspective: update.perspective,
      elementId: update.elementId,
      implementationState: update.recommendedState,
    }));
    validateImplementationStateUpdates(updates, withFindings.input);
    const changedBlocks = new Set(withFindings.changedBlocks);
    for (const update of updates) {
      const blockName = this.#blockForPerspective(update.perspective);
      const matches = this.#setImplementationState(
        blocks[blockName],
        update.elementId,
        update.implementationState,
      );
      if (matches !== 1) {
        throw new Error(
          `Expected one ${update.perspective} element "${update.elementId}", found ${matches}.`,
        );
      }
      changedBlocks.add(blockName);
    }
    const input: BackboneProposalInput = {
      ...withFindings.input,
      ...blocks,
    };
    validateBackboneProposal(input);
    const cleanupWarning = changedBlocks.size > 0
      ? await this.#replaceCanonicalBlocks(input, changedBlocks)
      : undefined;
    return {
      input,
      ...(cleanupWarning ? { cleanupWarning } : {}),
    };
  }

  async discard(runId: string): Promise<void> {
    await this.#removeTree(this.#runDirectory(runId));
  }

  async #readBlocks(runId: string): Promise<BackboneBlocks> {
    return {
      useCases: await this.#readBlock(runId, 'useCases'),
      contract: await this.#readBlock(runId, 'contract'),
      controlFlows: await this.#readBlock(runId, 'controlFlows'),
      guiSketches: await this.#readBlock(runId, 'guiSketches'),
      systemStacks: await this.#readBlock(runId, 'systemStacks'),
    };
  }

  async #replaceCanonicalBlocks(
    input: BackboneProposalInput,
    changedBlocks: ReadonlySet<BackboneBlockName>,
  ): Promise<string | undefined> {
    for (const name of changedBlocks) await this.#writeJson(join(this.#designDirectory, 'blocks', blockFiles[name]), input[name]);
    await this.#removeFile(this.#legacyImplementationProgressPath());
    return undefined;
  }

  async #readBlock<TName extends BackboneBlockName>(
    runId: string,
    name: TName,
  ): Promise<BackboneBlocks[TName]> {
    const path = join(this.#runDirectory(runId), 'blocks', blockFiles[name]);
    let content: string;
    try {
      content = await this.#readText(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Backbone block ${name} has not been submitted.`);
      }
      throw error;
    }
    return JSON.parse(content) as BackboneBlocks[TName];
  }

  async #readManifestBlocks(
    manifest: Pick<BackboneManifest, 'blocks'>,
  ): Promise<BackboneBlocks> {
    const read = <TName extends BackboneBlockName>(name: TName) =>
      this.#readJson<BackboneBlocks[TName]>(
        join(this.#designDirectory, manifest.blocks[name]),
      );
    return {
      useCases: await read('useCases'),
      contract: await read('contract'),
      controlFlows: await read('controlFlows'),
      guiSketches: await read('guiSketches'),
      systemStacks: await read('systemStacks'),
    };
  }

  async #readCurrentManifest(): Promise<BackboneManifest> {
    const manifest = await this.#readJson<
      BackboneManifest
      | LegacyV6Manifest
      | LegacyV5Manifest
      | LegacyV4Manifest
      | LegacyV3Manifest
      | LegacyCanonicalManifest
    >(this.#manifestPath());
    if (manifest.schemaVersion === 'living-design/v7') {
      return this.#normalizeManifestNotes(manifest);
    }
    if (manifest.schemaVersion === 'living-design/v6') {
      return this.#normalizeManifestNotes(await this.#upgradeV6Manifest(manifest));
    }
    if (manifest.schemaVersion === 'living-design/v5') {
      return this.#normalizeManifestNotes(await this.#upgradeV5Manifest(manifest));
    }
    if (manifest.schemaVersion === 'living-design/v4') {
      return this.#normalizeManifestNotes(await this.#upgradeV4Manifest(manifest));
    }
    if (manifest.schemaVersion === 'living-design/v3') {
      return this.#normalizeManifestNotes(await this.#upgradeV3Manifest(manifest));
    }
    if (
      manifest.schemaVersion === 'living-design/v1'
      || manifest.schemaVersion === 'living-design/v2'
    ) {
      return this.#normalizeManifestNotes(await this.#upgradeCanonicalManifest(manifest));
    }
    throw new Error(
      `Unsupported living design schema: ${String((manifest as { schemaVersion?: unknown }).schemaVersion)}.`,
    );
  }

  async #upgradeV6Manifest(
    legacy: LegacyV6Manifest,
  ): Promise<BackboneManifest> {
    const blocks = await this.#readManifestBlocks(legacy);
    this.#normalizeUseCaseProgress(blocks);
    await this.#writeNormalizedBlocks(blocks);
    const manifest: BackboneManifest = {
      ...legacy,
      schemaVersion: 'living-design/v7',
    };
    await this.#writeJson(this.#manifestPath(), manifest);
    return manifest;
  }

  async #upgradeV5Manifest(
    legacy: LegacyV5Manifest,
  ): Promise<BackboneManifest> {
    const blocks = await this.#readManifestBlocks(legacy);
    this.#normalizeUseCaseProgress(blocks);
    validateBackboneProposal({
      goal: legacy.goal,
      summary: legacy.summary,
      aspects: legacy.aspects,
      ...blocks,
    });
    await this.#writeNormalizedBlocks(blocks);
    const manifest: BackboneManifest = {
      ...legacy,
      schemaVersion: 'living-design/v7',
    };
    await this.#writeJson(this.#manifestPath(), manifest);
    return manifest;
  }

  async #upgradeV4Manifest(
    legacy: LegacyV4Manifest,
  ): Promise<BackboneManifest> {
    const blocks = await this.#readManifestBlocks(legacy);
    this.#normalizeUseCaseProgress(blocks);
    validateBackboneProposal({
      goal: legacy.goal,
      summary: legacy.summary,
      aspects: legacy.aspects,
      ...blocks,
    });
    await this.#writeNormalizedBlocks(blocks);
    const manifest: BackboneManifest = {
      ...legacy,
      schemaVersion: 'living-design/v7',
    };
    await this.#writeJson(this.#manifestPath(), manifest);
    return manifest;
  }

  async #upgradeV3Manifest(
    legacy: LegacyV3Manifest,
  ): Promise<BackboneManifest> {
    const blocks = await this.#readManifestBlocks(legacy);
    this.#normalizeUseCaseProgress(blocks);
    validateBackboneProposal({
      goal: legacy.goal,
      summary: legacy.summary,
      aspects: legacy.aspects,
      ...blocks,
    });
    await this.#writeNormalizedBlocks(blocks);
    const manifest: BackboneManifest = {
      ...legacy,
      schemaVersion: 'living-design/v7',
    };
    await this.#writeJson(this.#manifestPath(), manifest);
    return manifest;
  }

  async #upgradeCanonicalManifest(
    legacy: LegacyCanonicalManifest,
  ): Promise<BackboneManifest> {
    const blocks = await this.#readManifestBlocks(legacy);
    const upgraded = legacy.schemaVersion === 'living-design/v1'
      ? this.#withEmbeddedBlockStates(blocks)
      : structuredClone(blocks);
    let legacyStates: LegacyDesignElementState[] = [];
    if (legacy.elementStates) {
      try {
        legacyStates = await this.#readJson<LegacyDesignElementState[]>(
          join(this.#designDirectory, legacy.elementStates),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }
    for (const state of legacyStates) {
      const blockName = this.#blockForPerspective(state.perspective);
      this.#setImplementationState(
        upgraded[blockName],
        state.elementId,
        state.status === 'completed' ? 'implemented' : 'planned',
      );
    }
    for (const decision of legacy.decisions) {
      const blockName = this.#blockForPerspective(decision.context.perspective);
      const matches = this.#attachAttention(
        upgraded[blockName],
        decision.context.elementId,
        decision,
      );
      if (matches !== 1) {
        throw new Error(
          `Cannot migrate Attention item "${decision.question}" (${decision.id}): `
          + `${decision.context.perspective} element "${decision.context.elementId}" `
          + `matched ${matches} design entities.`,
        );
      }
    }
    this.#normalizeUseCaseProgress(upgraded);
    validateBackboneProposal({
      goal: legacy.goal,
      summary: legacy.summary,
      aspects: legacy.aspects,
      ...upgraded,
    });
    for (const name of Object.keys(blockFiles) as BackboneBlockName[]) {
      await this.#writeJson(
        join(this.#designDirectory, 'blocks', blockFiles[name]),
        upgraded[name],
      );
    }
    const manifest: BackboneManifest = {
      schemaVersion: 'living-design/v7',
      id: legacy.id,
      requestId: legacy.requestId,
      proposedAt: legacy.proposedAt,
      goal: legacy.goal,
      summary: legacy.summary,
      aspects: legacy.aspects,
      blocks: legacy.blocks,
      notes: legacy.notes,
      reviewSummaries: [],
    };
    if (legacy.elementStates) {
      await this.#removeFile(join(this.#designDirectory, legacy.elementStates));
    }
    await this.#removeTree(join(this.#designDirectory, 'attention-candidates'));
    await this.#removeTree(join(this.#designDirectory, 'attention-dispositions'));
    await this.#writeJson(this.#manifestPath(), manifest);
    return manifest;
  }

  #attachAttention(
    value: unknown,
    elementId: string,
    item: AnchoredAttentionItem,
  ): number {
    if (Array.isArray(value)) {
      return value.reduce(
        (count, nested) => count + this.#attachAttention(nested, elementId, item),
        0,
      );
    }
    if (!value || typeof value !== 'object') {
      return 0;
    }
    const entity = value as Record<string, unknown>;
    let matches = entity.id === elementId || entity.code === elementId ? 1 : 0;
    if (matches) {
      const embedded: AttentionItem = {
        id: item.id,
        impact: item.impact,
        question: item.question,
        whyItMatters: item.whyItMatters,
        alternatives: item.alternatives,
      };
      entity.attention = [
        ...(Array.isArray(entity.attention) ? entity.attention : []),
        embedded,
      ];
    }
    for (const [key, nested] of Object.entries(entity)) {
      if (key !== 'attention') {
        matches += this.#attachAttention(nested, elementId, item);
      }
    }
    return matches;
  }

  #blockForPerspective(perspective: DesignPerspective): BackboneBlockName {
    const entry = (Object.entries(blockPerspectives) as Array<
      [BackboneBlockName, DesignPerspective]
    >).find(([, candidate]) => candidate === perspective);
    if (!entry) {
      throw new Error(`Unknown design perspective: ${perspective}.`);
    }
    return entry[0];
  }

  #withEmbeddedBlockStates(blocks: BackboneBlocks): BackboneBlocks {
    const next = structuredClone(blocks);
    this.#normalizeUseCaseProgress(next);
    return next;
  }

  #withUseCaseImplementationStates(
    value: BackboneBlocks['useCases'],
    previousValue?: BackboneBlocks['useCases'],
  ): BackboneBlocks['useCases'] {
    const previousStates = new Map(
      (previousValue ?? []).map((useCase) => [
        useCase.id,
        normalizeImplementationState(useCase.implementationState) ?? 'planned',
      ]),
    );
    const next = structuredClone(value);
    this.#removeAllImplementationStates(next);
    for (const useCase of next) {
      useCase.implementationState = previousStates.get(useCase.id) ?? 'planned';
    }
    return next;
  }

  #normalizeUseCaseProgress(blocks: BackboneBlocks): void {
    const interactionStates = new Map(
      blocks.contract.interactions.map((interaction) => [
        interaction.id,
        this.#implementationStatesIn(interaction),
      ]),
    );
    const useCaseStates = new Map<string, ImplementationState>();
    for (const useCase of blocks.useCases) {
      const linkedFlowStates = blocks.controlFlows
        .filter(({ useCaseIds }) => useCaseIds.includes(useCase.id))
        .flatMap((flow) => this.#implementationStatesIn(flow));
      const linkedGuiStates = blocks.guiSketches
        .filter(({ useCaseIds }) => useCaseIds.includes(useCase.id))
        .flatMap((sketch) => this.#implementationStatesIn(sketch));
      const linkedInteractionStates = useCase.steps.flatMap((step) =>
        interactionStates.get(step.interactionId) ?? []);
      useCaseStates.set(
        useCase.id,
        aggregateImplementationState([
          ...this.#implementationStatesIn(useCase),
          ...linkedInteractionStates,
          ...linkedFlowStates,
          ...linkedGuiStates,
        ]),
      );
    }
    this.#removeAllImplementationStates(blocks);
    for (const useCase of blocks.useCases) {
      useCase.implementationState = useCaseStates.get(useCase.id) ?? 'planned';
    }
  }

  #implementationStatesIn(value: unknown): ImplementationState[] {
    const states: ImplementationState[] = [];
    const visit = (candidate: unknown): void => {
      if (Array.isArray(candidate)) {
        candidate.forEach(visit);
        return;
      }
      if (!candidate || typeof candidate !== 'object') {
        return;
      }
      const entity = candidate as Record<string, unknown>;
      if (typeof entity.implementationState === 'string') {
        const state = normalizeImplementationState(entity.implementationState);
        if (!state) {
          throw new Error(
            `Invalid implementation state: ${entity.implementationState}.`,
          );
        }
        states.push(state);
      }
      for (const [property, nested] of Object.entries(entity)) {
        if (property !== 'attention') {
          visit(nested);
        }
      }
    };
    visit(value);
    return states;
  }

  #normalizeLegacyUseCaseStates(
    useCases: BackboneBlocks['useCases'],
  ): boolean {
    let changed = false;
    for (const useCase of useCases) {
      const state = useCase.implementationState as string | undefined;
      if (
        state === 'blocked'
        || state === 'stale'
      ) {
        useCase.implementationState = 'in-progress';
        changed = true;
      }
    }
    return changed;
  }

  #removeAllImplementationStates(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) {
        this.#removeAllImplementationStates(item);
      }
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const entity = value as Record<string, unknown>;
    Reflect.deleteProperty(entity, 'implementationState');
    for (const [property, nested] of Object.entries(entity)) {
      if (property !== 'attention') {
        this.#removeAllImplementationStates(nested);
      }
    }
  }

  async #writeNormalizedBlocks(blocks: BackboneBlocks): Promise<void> {
    for (const name of Object.keys(blockFiles) as BackboneBlockName[]) {
      await this.#writeJson(
        join(this.#designDirectory, 'blocks', blockFiles[name]),
        blocks[name],
      );
    }
  }

  #setImplementationState(
    value: unknown,
    elementId: string,
    implementationState: ImplementationState,
  ): number {
    if (Array.isArray(value)) {
      return value.reduce(
        (count, item) =>
          count + this.#setImplementationState(item, elementId, implementationState),
        0,
      );
    }
    if (!value || typeof value !== 'object') {
      return 0;
    }
    const entity = value as Record<string, unknown>;
    let matches = entity.id === elementId || entity.code === elementId ? 1 : 0;
    if (matches) {
      entity.implementationState = implementationState;
    }
    for (const [property, nested] of Object.entries(entity)) {
      if (property !== 'attention' && nested !== implementationState) {
        matches += this.#setImplementationState(
          nested,
          elementId,
          implementationState,
        );
      }
    }
    return matches;
  }

  async #migrateLegacyCurrent(): Promise<PersistedBackboneProposal | undefined> {
    const legacyRoot = join(this.#workspace, '.tandem', 'living-canvas', 'backbones');
    let directories;
    try {
      directories = this.#projectionOnly ? await readdir(legacyRoot, { withFileTypes: true })
        : (await hostDirectoryEntries(this.#workspace, legacyRoot)).map((name) =>
          ({ name, isDirectory: () => !name.endsWith('.json') && !name.endsWith('.md') }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
    const discovered = await Promise.all(directories
      .filter((entry) => entry.isDirectory())
      .map(async (entry): Promise<{
        path: string;
        manifest?: LegacyBackboneManifest;
        error?: string;
      } | undefined> => {
        const path = join(legacyRoot, entry.name, 'proposal.json');
        try {
          return { path, manifest: await this.#readJson<LegacyBackboneManifest>(path) };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return undefined;
          }
          return { path, error: error instanceof Error ? error.message : String(error) };
        }
      }));
    const manifests = discovered.filter((entry): entry is {
      path: string;
      manifest: LegacyBackboneManifest;
    } => Boolean(entry?.manifest));
    const failures = discovered
      .flatMap((entry) => entry?.error ? [entry.error] : []);
    manifests.sort((left, right) =>
      right.manifest.proposedAt.localeCompare(left.manifest.proposedAt)
      || right.path.localeCompare(left.path));
    if (manifests.length === 0) {
      if (failures.length > 0) {
        throw new Error(
          `Legacy living-design artifacts were found, but none were valid: ${failures.join('; ')}`,
        );
      }
      return undefined;
    }

    for (const { path, manifest } of manifests) {
      try {
        return await this.#importLegacyManifest(path, manifest);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    throw new Error(
      `Legacy living-design artifacts were found, but none were valid: ${failures.join('; ')}`,
    );
  }

  async #importLegacyManifest(
    path: string,
    legacy: LegacyBackboneManifest,
  ): Promise<PersistedBackboneProposal> {
    const legacyDirectory = dirname(path);
    const readBlock = <TName extends BackboneBlockName>(name: TName) =>
      this.#readJson<BackboneBlocks[TName]>(
        join(legacyDirectory, legacy.blocks[name]),
      );
    const blocks: BackboneBlocks = {
      useCases: await readBlock('useCases'),
      contract: await readBlock('contract'),
      controlFlows: await readBlock('controlFlows'),
      guiSketches: await readBlock('guiSketches'),
      systemStacks: await readBlock('systemStacks'),
    };
    const embeddedBlocks = this.#withEmbeddedBlockStates(blocks);
    for (const decision of legacy.decisions) {
      const blockName = this.#blockForPerspective(decision.context.perspective);
      const matches = this.#attachAttention(
        embeddedBlocks[blockName],
        decision.context.elementId,
        decision,
      );
      if (matches !== 1) {
        throw new Error(
          `Cannot import Attention item "${decision.question}" (${decision.id}): `
          + `${decision.context.perspective} element "${decision.context.elementId}" `
          + `matched ${matches} design entities.`,
        );
      }
    }
    const input: BackboneProposalInput = {
      goal: legacy.goal,
      summary: legacy.summary,
      aspects: legacy.aspects,
      ...embeddedBlocks,
    };
    validateBackboneProposal(input);

    for (const name of Object.keys(blockFiles) as BackboneBlockName[]) {
      await this.#writeJson(
        join(this.#designDirectory, 'blocks', blockFiles[name]),
        embeddedBlocks[name],
      );
    }
    const notes = [
      'Imported the latest valid legacy living design into the canonical workspace artifact.',
    ];
    await this.#writeInitialNotes(new Date().toISOString(), notes);
    await this.#removeFile(join(this.#designDirectory, 'changes.md'));
    await this.#writeJson(this.#manifestPath(), {
      schemaVersion: 'living-design/v7',
      id: legacy.id,
      requestId: legacy.requestId,
      proposedAt: legacy.proposedAt,
      goal: legacy.goal,
      summary: legacy.summary,
      aspects: legacy.aspects,
      blocks: Object.fromEntries(
        Object.entries(blockFiles).map(([name, file]) => [name, join('blocks', file)]),
      ) as Record<BackboneBlockName, string>,
      notes,
      reviewSummaries: [],
    } satisfies BackboneManifest);
    return {
      id: legacy.id,
      requestId: legacy.requestId,
      proposedAt: legacy.proposedAt,
      input,
      artifactPath: relative(this.#workspace, this.#manifestPath()),
      notes,
      reviewSummaries: [],
    };
  }

  #manifestPath(): string {
    return join(this.#designDirectory, 'manifest.json');
  }

  #legacyImplementationProgressPath(): string {
    return join(this.#designDirectory, legacyImplementationProgressFile);
  }

  #runDirectory(runId: string): string {
    return join(this.#stagingRoot, runId);
  }

  #formatNoteSection(timestamp: string, notes: string[], title = timestamp): string {
    const entries = [...new Set(notes)]
      .map((note) => `- ${note.replace(/\s+/g, ' ').trim()}`)
      .join('\n');
    return `## ${title}\n\n${entries}\n`;
  }

  #deduplicateNoteText(content: string, notes: string[]): string {
    const remaining = new Map<string, number>();
    for (const note of new Set(notes)) {
      const line = `- ${note.replace(/\s+/g, ' ').trim()}`;
      remaining.set(line, (remaining.get(line) ?? 0) + 1);
    }
    // Distinct raw notes can render identically. Keep their separate occurrences,
    // and leave unknown checkpoint notes, headings, and application markers intact.
    return content.split(/(?<=\n)/).filter((line) => {
      const entry = line.replace(/\r?\n$/, '');
      const count = remaining.get(entry);
      if (count === undefined) {
        return true;
      }
      if (count === 0) {
        return false;
      }
      remaining.set(entry, count - 1);
      return true;
    }).join('');
  }

  async #normalizeManifestNotes(manifest: BackboneManifest): Promise<BackboneManifest> {
    const notes = [...new Set(manifest.notes)];
    if (notes.length !== manifest.notes.length) {
      manifest = { ...manifest, notes };
      await this.#writeJson(this.#manifestPath(), manifest);
    }
    const path = join(this.#designDirectory, 'notes.md');
    let content: string;
    try {
      content = await this.#readText(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return manifest;
      }
      throw error;
    }
    const lastApplication = [...content.matchAll(/^<!-- (?:tandem|teleos)-application:(.+) -->\r?$/gm)]
      .at(-1)?.[1];
    if (lastApplication && lastApplication !== manifest.id) {
      // A newer notes checkpoint must not be normalized against the old manifest.
      return manifest;
    }
    const normalized = this.#deduplicateNoteText(content, notes);
    if (normalized !== content) {
      await this.#writeText(path, normalized);
    }
    return manifest;
  }

  async #writeInitialNotes(timestamp: string, notes: string[]): Promise<void> {
    await this.#writeText(
      join(this.#designDirectory, 'notes.md'),
      `# Design notes\n\n${this.#formatNoteSection(timestamp, notes)}`,
    );
  }

  async #appendNotes(
    timestamp: string,
    notes: string[],
    title = timestamp,
    applicationId?: string,
    inheritedNotes: string[] = [],
  ): Promise<void> {
    const path = join(this.#designDirectory, 'notes.md');
    let existing = '# Design notes\n';
    try {
      existing = await this.#readText(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    const marker = applicationId
      ? `<!-- tandem-application:${applicationId} -->`
      : undefined;
    const markerRecorded = marker !== undefined && existing.includes(marker);
    const inherited = new Set(inheritedNotes);
    const added = [...new Set(notes)].filter((note) => !inherited.has(note));
    let updated = existing;
    if (!markerRecorded && (added.length > 0 || marker)) {
      updated = `${existing.trimEnd()}\n\n${marker ? `${marker}\n` : ''}${
        added.length > 0 ? this.#formatNoteSection(timestamp, added, title) : ''
      }`;
    }
    updated = this.#deduplicateNoteText(updated, [...inheritedNotes, ...notes]);
    if (updated !== existing) {
      await this.#writeText(path, updated);
    }
  }

  async #consolidateLegacyChanges(inheritedNotes: string[]): Promise<string[]> {
    const path = join(this.#designDirectory, 'changes.md');
    let content: string;
    try {
      content = await this.#readText(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    const notes = [...new Set(content
      .split(/\r?\n/)
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2))
      .filter((note) => note.trim().length > 0))];
    if (notes.length > 0) {
      await this.#appendNotes(
        new Date().toISOString(),
        notes,
        'Imported change history',
        undefined,
        inheritedNotes,
      );
    }
    await this.#removeFile(path);
    return notes;
  }

  async #readJson<T>(path: string): Promise<T> {
    return JSON.parse(await this.#readText(path)) as T;
  }

  async #writeJson(path: string, value: unknown): Promise<void> {
    await this.#writeText(path, `${JSON.stringify(value, null, 2)}\n`);
  }

  async #writeText(path: string, value: string): Promise<void> {
    if (this.#projectionOnly) {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, value, 'utf8');
      await renameWithRetry(temporary, path);
      return;
    }
    const file = this.#file(path);
    await file.run('write-design-state', () => file.write('write-design-state', value));
  }
}
