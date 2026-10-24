import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import {
  type BackboneBlocks,
  type BackboneProposalInput,
  type DesignPerspective,
  type ImplementationState,
  type ImplementationStateUpdate,
  validateBackboneProposal,
  validateImplementationStateUpdates,
} from './backbone/proposal.ts';
import {
  attentionItemsSchema,
  type AttentionItem,
} from './backbone/schema-primitives.ts';
import { LEGACY_V1_POLICY, parsePolicySnapshot, type PolicySnapshot } from './workflow/policy.ts';

type BackboneBlockName = keyof BackboneBlocks;

interface ImplementationFileState {
  content: Buffer;
  hash: string;
  size: number;
}

export type ImplementationWorkspaceSnapshot =
  ReadonlyMap<string, ImplementationFileState>;

export interface ImplementationFileFingerprint {
  path: string;
  hash: string;
  size: number;
}

export function implementationWorkspaceInventory(
  snapshot: ImplementationWorkspaceSnapshot,
): ImplementationFileFingerprint[] {
  return [...snapshot]
    .map(([path, state]) => ({
      path,
      hash: state.hash,
      size: state.size,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function implementationInventoriesMatch(
  left: readonly ImplementationFileFingerprint[],
  right: readonly ImplementationFileFingerprint[],
): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      const other = right[index];
      return other !== undefined
        && item.path === other.path
        && item.hash === other.hash
        && item.size === other.size;
    });
}

export interface ImplementationChangeSummary {
  reviewScope?: 'turn' | 'workspace-bootstrap' | 'workspace-reconciliation';
  addedFiles: string[];
  modifiedFiles: string[];
  deletedFiles: string[];
  changedFiles: string[];
  changedBytes: number;
  details: ImplementationFileChange[];
}

export function expandImplementationReviewToWorkspace(
  changes: ImplementationChangeSummary,
  workspace: ImplementationWorkspaceSnapshot,
  reviewScope: 'workspace-bootstrap' | 'workspace-reconciliation' = 'workspace-bootstrap',
): ImplementationChangeSummary {
  return {
    ...changes,
    reviewScope,
    changedFiles: [...new Set([
      ...changes.changedFiles,
      ...workspace.keys(),
    ])].sort(),
  };
}

export interface ImplementationFileChange {
  path: string;
  kind: 'added' | 'modified' | 'deleted';
  changedBytes: number;
  beforeExcerpt?: string;
  afterExcerpt?: string;
  excerptTruncated: boolean;
}

export interface ImplementationReviewEvidence {
  path: string;
  observation: string;
}

export interface ImplementationReviewFinding {
  perspective: DesignPerspective;
  elementId: string;
  attention: AttentionItem;
  evidence: ImplementationReviewEvidence[];
}

export type DuringImplementationState = Exclude<ImplementationState, 'verified'>;

export interface ImplementationStateReconciliation {
  perspective: 'use-case';
  elementId: string;
  currentState: ImplementationState;
  recommendedState: DuringImplementationState;
  rationale: string;
  evidence: ImplementationReviewEvidence[];
}

export interface ImplementationReviewResult {
  status: 'consistent' | 'attention-required';
  summary: string;
  findings: ImplementationReviewFinding[];
  stateUpdates: ImplementationStateReconciliation[];
}

export interface ImplementationFileTrackerOptions {
  includedExtensions?: Iterable<string>;
  includedFileNames?: Iterable<string>;
  excludedDirectories?: Iterable<string>;
}

const defaultIncludedExtensions = [
  '.c', '.cc', '.cpp', '.cs', '.css', '.go', '.h', '.hpp', '.html',
  '.java', '.js', '.json', '.jsx', '.kt', '.kts', '.mjs', '.php',
  '.ps1', '.py', '.rb', '.rs', '.scala', '.sh', '.sql', '.svelte',
  '.swift', '.toml', '.ts', '.tsx', '.txt', '.vue', '.xml', '.yaml', '.yml',
];

const defaultIncludedFileNames = [
  'dockerfile',
  'makefile',
  'procfile',
  'readme.md',
];

const defaultExcludedDirectories = [
  '.git',
  '.tandem',
  '.next',
  '.nuxt',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'vendor',
];

const blockForPerspective: Record<DesignPerspective, BackboneBlockName> = {
  'use-case': 'useCases',
  contract: 'contract',
  flow: 'controlFlows',
  gui: 'guiSketches',
  system: 'systemStacks',
};

export const implementationReviewResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: {
      type: 'string',
      enum: ['consistent', 'attention-required'],
    },
    summary: { type: 'string', minLength: 1, maxLength: 240 },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          perspective: {
            type: 'string',
            enum: ['use-case', 'contract', 'flow', 'gui', 'system'],
          },
          elementId: { type: 'string', minLength: 1, maxLength: 40 },
          attention: attentionItemsSchema.items,
          evidence: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', minLength: 1, maxLength: 260 },
                observation: { type: 'string', minLength: 1, maxLength: 200 },
              },
              required: ['path', 'observation'],
            },
          },
        },
        required: ['perspective', 'elementId', 'attention', 'evidence'],
      },
    },
    stateUpdates: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          perspective: {
            type: 'string',
            const: 'use-case',
          },
          elementId: { type: 'string', minLength: 1, maxLength: 40 },
          currentState: {
            type: 'string',
            enum: ['planned', 'in-progress', 'implemented', 'verified'],
          },
          recommendedState: {
            type: 'string',
            enum: ['planned', 'in-progress', 'implemented'],
          },
          rationale: { type: 'string', minLength: 1, maxLength: 240 },
          evidence: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', minLength: 1, maxLength: 260 },
                observation: { type: 'string', minLength: 1, maxLength: 200 },
              },
              required: ['path', 'observation'],
            },
          },
        },
        required: [
          'perspective',
          'elementId',
          'currentState',
          'recommendedState',
          'rationale',
          'evidence',
        ],
      },
    },
  },
  required: ['status', 'summary', 'findings', 'stateUpdates'],
} as const;

export class WorkspaceImplementationFileTracker {
  readonly #workspace: string;
  readonly #includedExtensions: ReadonlySet<string>;
  readonly #includedFileNames: ReadonlySet<string>;
  readonly #excludedDirectories: ReadonlySet<string>;

  constructor(workspace: string, options: ImplementationFileTrackerOptions = {}) {
    this.#workspace = workspace;
    this.#includedExtensions = new Set(
      [...(options.includedExtensions ?? defaultIncludedExtensions)]
        .map((value) => value.toLowerCase()),
    );
    this.#includedFileNames = new Set(
      [...(options.includedFileNames ?? defaultIncludedFileNames)]
        .map((value) => value.toLowerCase()),
    );
    this.#excludedDirectories = new Set(
      [...(options.excludedDirectories ?? defaultExcludedDirectories)]
        .map((value) => value.toLowerCase()),
    );
  }

  async snapshot(): Promise<ImplementationWorkspaceSnapshot> {
    const files = new Map<string, ImplementationFileState>();
    await this.#scanDirectory(this.#workspace, files);
    return files;
  }

  summarize(
    before: ImplementationWorkspaceSnapshot,
    after: ImplementationWorkspaceSnapshot,
  ): ImplementationChangeSummary {
    const addedFiles: string[] = [];
    const modifiedFiles: string[] = [];
    const deletedFiles: string[] = [];
    const details: ImplementationFileChange[] = [];
    let changedBytes = 0;

    for (const [path, current] of after) {
      const previous = before.get(path);
      if (!previous) {
        addedFiles.push(path);
        const detail = fileChangeDetail(path, 'added', undefined, current.content);
        details.push(detail);
        changedBytes += detail.changedBytes;
      } else if (previous.hash !== current.hash) {
        modifiedFiles.push(path);
        const detail = fileChangeDetail(
          path,
          'modified',
          previous.content,
          current.content,
        );
        details.push(detail);
        changedBytes += detail.changedBytes;
      }
    }
    for (const [path, previous] of before) {
      if (!after.has(path)) {
        deletedFiles.push(path);
        const detail = fileChangeDetail(path, 'deleted', previous.content, undefined);
        details.push(detail);
        changedBytes += detail.changedBytes;
      }
    }

    addedFiles.sort();
    modifiedFiles.sort();
    deletedFiles.sort();
    return {
      addedFiles,
      modifiedFiles,
      deletedFiles,
      changedFiles: [...addedFiles, ...modifiedFiles, ...deletedFiles].sort(),
      changedBytes,
      details: details.sort((left, right) => left.path.localeCompare(right.path)),
    };
  }

  async #scanDirectory(
    directory: string,
    files: Map<string, ImplementationFileState>,
  ): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!this.#excludedDirectories.has(entry.name.toLowerCase())) {
          await this.#scanDirectory(path, files);
        }
        continue;
      }
      if (!entry.isFile() || !this.#isImplementationFile(entry.name)) {
        continue;
      }
      const content = await readFile(path);
      files.set(relative(this.#workspace, path), {
        content,
        hash: createHash('sha256').update(content).digest('hex'),
        size: content.byteLength,
      });
    }

  }

  #isImplementationFile(name: string): boolean {
    const normalizedName = name.toLowerCase();
    return this.#includedFileNames.has(normalizedName)
      || this.#includedExtensions.has(extname(normalizedName));
  }
}

function fileChangeDetail(
  path: string,
  kind: ImplementationFileChange['kind'],
  before: Buffer | undefined,
  after: Buffer | undefined,
): ImplementationFileChange {
  const previous = before ?? Buffer.alloc(0);
  const current = after ?? Buffer.alloc(0);
  let prefix = 0;
  while (
    prefix < previous.length
    && prefix < current.length
    && previous[prefix] === current[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < previous.length - prefix
    && suffix < current.length - prefix
    && previous[previous.length - suffix - 1] === current[current.length - suffix - 1]
  ) {
    suffix += 1;
  }

  const previousChangedEnd = previous.length - suffix;
  const currentChangedEnd = current.length - suffix;
  const contextStart = Math.max(0, prefix - 200);
  const previousContextEnd = Math.min(previous.length, previousChangedEnd + 200);
  const currentContextEnd = Math.min(current.length, currentChangedEnd + 200);
  const beforeExcerpt = before
    ? boundedExcerpt(previous.subarray(contextStart, previousContextEnd))
    : undefined;
  const afterExcerpt = after
    ? boundedExcerpt(current.subarray(contextStart, currentContextEnd))
    : undefined;
  return {
    path,
    kind,
    changedBytes: (previousChangedEnd - prefix) + (currentChangedEnd - prefix),
    ...(beforeExcerpt ? { beforeExcerpt: beforeExcerpt.value } : {}),
    ...(afterExcerpt ? { afterExcerpt: afterExcerpt.value } : {}),
    excerptTruncated: Boolean(beforeExcerpt?.truncated || afterExcerpt?.truncated),
  };
}

function boundedExcerpt(content: Buffer): { value: string; truncated: boolean } {
  const maximumBytes = LEGACY_V1_POLICY.values.resources.excerptBytes;
  const truncated = content.length > maximumBytes;
  const excerpt = truncated ? content.subarray(0, maximumBytes) : content;
  return {
    value: excerpt.toString('utf8'),
    truncated,
  };
}

export function applyImplementationReviewFindings(
  input: BackboneProposalInput,
  findings: ImplementationReviewFinding[],
  policy: PolicySnapshot = LEGACY_V1_POLICY,
): {
  input: BackboneProposalInput;
  changedBlocks: Set<BackboneBlockName>;
} {
  const blocks: BackboneBlocks = structuredClone({
    useCases: input.useCases,
    contract: input.contract,
    controlFlows: input.controlFlows,
    guiSketches: input.guiSketches,
    systemStacks: input.systemStacks,
  });
  const changedBlocks = new Set<BackboneBlockName>();
  for (const finding of findings) {
    const blockName = blockForPerspective[finding.perspective];
    const matches = attachAttention(
      blocks[blockName],
      finding.elementId,
      finding.attention,
    );
    if (matches !== 1) {
      throw new Error(
        `Expected one ${finding.perspective} element "${finding.elementId}", found ${matches}.`,
      );
    }
    changedBlocks.add(blockName);
  }
  const updated: BackboneProposalInput = {
    ...input,
    ...blocks,
  };
  validateBackboneProposal(updated, policy);
  return { input: updated, changedBlocks };
}

export function validateImplementationReviewResult(
  result: ImplementationReviewResult,
  input: BackboneProposalInput,
  changes: ImplementationChangeSummary,
  policy: PolicySnapshot = LEGACY_V1_POLICY,
): void {
  const limits = parsePolicySnapshot(policy).values.schema;
  if (typeof result.summary !== 'string' || !result.summary || result.summary.length > limits['review.summary.maxLength']) {
    throw new Error(`Implementation review requires a concise summary (1-${limits['review.summary.maxLength']} characters).`);
  }
  if (
    (result.status === 'consistent' && result.findings.length !== 0)
    || (result.status === 'attention-required' && result.findings.length === 0)
  ) {
    throw new Error('Implementation review status must agree with its findings.');
  }

  const changedPaths = new Set(changes.changedFiles.map(normalizeRelativePath));
  const findingIds = new Set<string>();
  for (const finding of result.findings) {
    if (findingIds.has(finding.attention.id)) {
      throw new Error(`Implementation review finding ID must be unique: ${finding.attention.id}.`);
    }
    findingIds.add(finding.attention.id);
    if (finding.evidence.length < limits['review.findings.evidence.minItems']
      || finding.evidence.length > limits['review.findings.evidence.maxItems']) {
      throw new Error(`Implementation review finding ${finding.attention.id} requires code evidence.`);
    }
    if (!finding.evidence.some(({ path }) => changedPaths.has(normalizeRelativePath(path)))) {
      throw new Error(
        `Implementation review finding ${finding.attention.id} must cite a changed implementation file.`,
      );
    }
  }

  applyImplementationReviewFindings(input, result.findings, policy);
  const updateKeys = new Set<string>();
  const updates: ImplementationStateUpdate[] = [];
  for (const update of result.stateUpdates) {
    const key = `${update.perspective}:${update.elementId}`;
    if (update.perspective !== 'use-case') {
      throw new Error('Only top-level Use cases carry implementation lifecycle state.');
    }
    if (updateKeys.has(key)) {
      throw new Error(`Implementation state reconciliation must be unique: ${key}.`);
    }
    updateKeys.add(key);
    if (update.currentState === update.recommendedState) {
      throw new Error(`Implementation state reconciliation ${key} must change state.`);
    }
    if (update.evidence.length < limits['review.stateUpdates.evidence.minItems']) {
      throw new Error(`Implementation state reconciliation ${key} requires code evidence.`);
    }
    if (!update.evidence.some(({ path }) => changedPaths.has(normalizeRelativePath(path)))) {
      throw new Error(
        `Implementation state reconciliation ${key} must cite a changed implementation file.`,
      );
    }
    const actualState = implementationStateFor(input, update.perspective, update.elementId);
    if (actualState !== update.currentState) {
      throw new Error(
        `Implementation state reconciliation ${key} expected ${update.currentState}, found ${
          actualState ?? 'no state'
        }.`,
      );
    }
    if (
      (update as { recommendedState: string }).recommendedState === 'verified'
    ) {
      throw new Error(
        `Implementation state reconciliation ${key} cannot set verified during implementation.`,
      );
    }
    updates.push({
      perspective: update.perspective,
      elementId: update.elementId,
      implementationState: update.recommendedState,
    });
  }
  validateImplementationStateUpdates(updates, input);
}

function implementationStateFor(
  input: BackboneProposalInput,
  perspective: DesignPerspective,
  elementId: string,
): ImplementationState | undefined {
  if (perspective !== 'use-case') {
    return undefined;
  }
  const useCase = input.useCases.find(({ id }) => id === elementId);
  return useCase?.implementationState ?? 'planned';
}

function attachAttention(
  value: unknown,
  elementId: string,
  attention: AttentionItem,
): number {
  if (Array.isArray(value)) {
    return value.reduce(
      (count, item) => count + attachAttention(item, elementId, attention),
      0,
    );
  }
  if (!value || typeof value !== 'object') {
    return 0;
  }
  const entity = value as Record<string, unknown>;
  let matches = entity.id === elementId || entity.code === elementId ? 1 : 0;
  if (matches) {
    entity.attention = [
      ...(Array.isArray(entity.attention) ? entity.attention : []),
      structuredClone(attention),
    ];
  }
  for (const [key, nested] of Object.entries(entity)) {
    if (key !== 'attention') {
      matches += attachAttention(nested, elementId, attention);
    }
  }
  return matches;
}

function normalizeRelativePath(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  if (
    normalized.startsWith('/')
    || /^[a-z]:\//i.test(normalized)
    || normalized.split('/').includes('..')
  ) {
    throw new Error(`Implementation evidence path must be workspace-relative: ${path}.`);
  }
  return normalized.replace(/^\.\//, '');
}
