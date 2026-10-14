import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, opendir, rm } from 'node:fs/promises';
import { readFile, writeFile } from './helpers/host-state-fixture.ts';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { closeHostStateWal } from '../../runtime-src/domain/host-state-wal.ts';
import { InMemoryEventStore } from '../../runtime-src/event-store.js';
import {
  BackboneArtifactStore,
  type BackboneBlockName,
} from '../../runtime-src/domain/backbone/artifact-store.js';
import {
  validateDesignReviewSummary,
  collectAttentionItems,
  findAttentionItem,
  type BackboneProposalInput,
  type DesignReviewSummary,
} from '../../runtime-src/domain/backbone/proposal.js';
import {
  WorkspaceImplementationFileTracker,
  expandImplementationReviewToWorkspace,
  applyImplementationReviewFindings,
  type ImplementationChangeSummary,
  type ImplementationReviewResult,
  validateImplementationReviewResult,
} from '../../runtime-src/domain/implementation-review.js';

const attentionItem = {
  id: 'task-identity',
  impact: 'blocking' as const,
  question: 'Should clients supply task IDs?',
  whyItMatters: 'ID ownership changes retry and deduplication behavior.',
  alternatives: [
    { option: 'Server-generated IDs', implication: 'Simple clients; retries need idempotency keys.' },
    { option: 'Client-generated IDs', implication: 'Natural deduplication; clients own uniqueness.' },
  ],
};

const legacyAttentionItem = {
  ...attentionItem,
  designElement: 'Create task',
  context: {
    perspective: 'contract' as const,
    elementId: 'create-task',
  },
};

const implementationReviewResult: ImplementationReviewResult = {
  status: 'attention-required',
  summary: 'The implementation selected an ordering contract absent from the design.',
  stateUpdates: [],
  findings: [{
    perspective: 'contract',
    elementId: 'list-tasks',
    attention: {
      id: 'task-ordering',
      impact: 'non-blocking',
      question: 'Which order should the task list guarantee?',
      whyItMatters: 'The implementation exposes newest-first order as observable behavior.',
      alternatives: [
        { option: 'Newest first', implication: 'Keep the implementation and document the order.' },
        { option: 'Unspecified order', implication: 'Remove ordering assumptions from the implementation.' },
      ],
    },
    evidence: [{
      path: 'src\\list-tasks.ts',
      observation: 'The query sorts created timestamps in descending order.',
    }],
  }],
};

const proposal: BackboneProposalInput = {
  goal: 'Provide a personal task API.',
  summary: 'An HTTP client uses a task service backed by persistent storage.',
  useCases: [
    {
      id: 'capture-task',
      title: 'Capture a new task',
      actor: 'Task user',
      outcome: 'The task is saved and visible in the task list.',
      steps: [{
        id: 'enter-task',
        userAction: 'Enter a title and submit it.',
        systemResponse: 'Show the newly created task.',
        interactionId: 'create-task',
      }],
    },
    {
      id: 'review-tasks',
      title: 'Review saved tasks',
      actor: 'Task user',
      outcome: 'The user sees current work.',
      steps: [{
        id: 'view-task',
        userAction: 'Open the task list.',
        systemResponse: 'Show the saved task.',
        interactionId: 'list-tasks',
      }],
    },
  ],
  controlFlows: [],
  guiSketches: [],
  systemStacks: [],
  aspects: [{
    id: 'contract',
    kind: 'contract',
    title: 'Task API contract',
    summary: 'Defines task commands, results, and failures.',
    relatedElements: ['Task client', 'Task service'],
  }],
  contract: {
    schemaVersion: 'contract-set/v1',
    title: 'Task API',
    context: 'The client manages tasks through the service.',
    participants: [
      { id: 'task-client', name: 'Task client', responsibility: 'Issues authenticated task requests.' },
      { id: 'task-service', name: 'Task service', responsibility: 'Validates and persists tasks.' },
    ],
    interactions: [{
      id: 'create-task',
      name: 'Create task',
      kind: 'command',
      fromParticipantId: 'task-client',
      toParticipantId: 'task-service',
      input: { name: 'CreateTask', description: 'A title and optional description.' },
      output: { name: 'Task', description: 'The persisted task with its generated ID.' },
      errors: [{ code: 'invalid-title', meaning: 'The title is invalid.' }],
      attention: [attentionItem],
      guarantees: [{
        id: 'durable-on-success',
        statement: 'A successful response represents a durable task.',
      }],
    }, {
      id: 'list-tasks',
      name: 'List tasks',
      kind: 'query',
      fromParticipantId: 'task-client',
      toParticipantId: 'task-service',
      input: { name: 'ListTasks', description: 'An authenticated list request.' },
      output: { name: 'TaskPage', description: 'The user task collection.' },
      errors: [{ code: 'unauthenticated', meaning: 'Authentication is required.' }],
      guarantees: [{
        id: 'owner-scope',
        statement: 'Only the user tasks are returned.',
      }],
    }],
    storageContracts: [{
      id: 'task-store',
      name: 'Task store',
      medium: 'database',
      ownerParticipantId: 'task-service',
      purpose: 'Persist task state across service restarts.',
      records: [{
        id: 'task-record',
        name: 'Task',
        description: 'The durable representation of a personal task.',
        fields: [
          {
            id: 'task-id',
            name: 'id',
            type: 'string',
            required: true,
            description: 'Stable task identifier.',
          },
          {
            id: 'task-title',
            name: 'title',
            type: 'string',
            required: true,
            description: 'User-visible task title.',
          },
          {
            id: 'task-completed',
            name: 'completed',
            type: 'boolean',
            required: true,
            description: 'Whether the task is complete.',
          },
        ],
        keys: [{
          id: 'task-primary-key',
          kind: 'primary',
          fieldIds: ['task-id'],
          purpose: 'Address one stable task.',
        }],
        constraints: [{
          id: 'task-title-required',
          statement: 'The title must not be empty.',
        }],
      }],
      relations: [],
      guarantees: [{
        id: 'task-write-durable',
        statement: 'Acknowledged writes survive a service restart.',
      }],
      lifecycleRules: [{
        id: 'task-delete-removes-record',
        statement: 'Deleting a task removes its stored record.',
      }],
    }],
    lifecycleRules: [{
      id: 'stable-task-id',
      statement: 'A task ID remains stable after creation.',
    }],
  },
};

const reviewSummary: DesignReviewSummary = {
  headline: 'Task creation now has an explicit durability promise.',
  changes: [{
    id: 'durable-create',
    title: 'Successful creates are durable',
    description: 'The create-task contract now promises that saved tasks survive a restart.',
    whyItMatters: 'Users can trust a successful response without checking the task again.',
    visibility: 'summary-only',
    perspective: 'contract',
    elementId: 'create-task',
  }],
};

async function createNoteDesign(workspace: string, notes: string[]) {
  const artifacts = new BackboneArtifactStore(workspace);
  for (const name of ['useCases', 'contract', 'controlFlows', 'guiSketches', 'systemStacks'] as const) {
    await artifacts.writeBlock('initial', name, proposal[name]);
  }
  const original = await artifacts.conclude('initial', 'request-initial', {
    goal: proposal.goal,
    summary: proposal.summary,
    aspects: proposal.aspects,
    notes,
    reviewSummary,
  });
  const manifestPath = join(workspace, original.artifactPath);
  return {
    artifacts,
    original,
    manifestPath,
    notesPath: join(dirname(manifestPath), 'notes.md'),
    changesPath: join(dirname(manifestPath), 'changes.md'),
  };
}

test('read-only current design inspection preserves bytes and refuses implicit migration or noncanonical block paths', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tandem-readonly-design-'));
  try {
    const empty = new BackboneArtifactStore(workspace);
    assert.equal(await empty.inspectCurrent(), undefined);
    await assert.rejects(access(join(workspace, '.tandem')), { code: 'ENOENT' });
    const c = await createNoteDesign(workspace, ['Exact design note.']);
    await writeFile(c.changesPath, 'Legacy notes must not be consolidated by a read.\n');
    const original = await readFile(c.manifestPath, 'utf8');
    const current = await c.artifacts.inspectCurrent();
    assert.deepEqual(current?.input, c.original.input);
    assert.equal(await readFile(c.manifestPath, 'utf8'), original);
    assert.equal(await readFile(c.changesPath, 'utf8'), 'Legacy notes must not be consolidated by a read.\n');
    const legacy = JSON.parse(original);
    legacy.schemaVersion = 'living-design/v6';
    await writeFile(c.manifestPath, JSON.stringify(legacy));
    await assert.rejects(c.artifacts.inspectCurrent(), /v7 publication/);
    assert.equal(await readFile(c.manifestPath, 'utf8'), JSON.stringify(legacy));
    const unsafe = JSON.parse(original);
    unsafe.blocks.useCases = '..\\outside.json';
    await writeFile(c.manifestPath, JSON.stringify(unsafe));
    await assert.rejects(c.artifacts.inspectCurrent(), /non-canonical/);
  } finally { await closeHostStateWal(workspace); await rm(workspace, { recursive: true, force: true }); }
});

test('requires every design-review change to have one unique current-design anchor', () => {
  validateDesignReviewSummary(reviewSummary, proposal);
  assert.throws(
    () => validateDesignReviewSummary({
      ...reviewSummary,
      changes: [{
        ...reviewSummary.changes[0]!,
        elementId: 'missing-element',
      }],
    }, proposal),
    /must anchor to exactly one Contract element "missing-element"; found 0/,
  );
  assert.throws(
    () => validateDesignReviewSummary({
      ...reviewSummary,
      changes: [
        reviewSummary.changes[0]!,
        {
          ...reviewSummary.changes[0]!,
          title: 'Duplicate summary item',
          elementId: 'list-tasks',
        },
      ],
    }, proposal),
    /Design-review change ID must be unique: durable-create/,
  );
});

test('resolves an embedded Attention item by its globally unique ID without mutating it', () => {
  const linked = findAttentionItem(proposal, 'task-identity');

  assert.equal(linked?.question, attentionItem.question);
  assert.deepEqual(linked?.context, {
    perspective: 'contract',
    elementId: 'create-task',
  });
  assert.equal(findAttentionItem(proposal, 'removed-attention'), undefined);
  assert.equal(collectAttentionItems(proposal).length, 1);
});

test('persists perspective blocks and concludes them through a short manifest', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'living-canvas-blocks-'));
  try {
    const artifacts = new BackboneArtifactStore(workspace);
    await artifacts.writeBlock('design-1', 'useCases', proposal.useCases);
    await artifacts.writeBlock('design-1', 'contract', proposal.contract);
    await artifacts.writeBlock('design-1', 'controlFlows', proposal.controlFlows);
    await artifacts.writeBlock('design-1', 'guiSketches', proposal.guiSketches);
    await artifacts.writeBlock('design-1', 'systemStacks', proposal.systemStacks);

    const persisted = await artifacts.conclude('design-1', 'request-1', {
      goal: proposal.goal,
      summary: proposal.summary,
      aspects: proposal.aspects,
      notes: [
        'Created the initial task-service design.',
        'Task IDs remain an open contract choice.',
      ],
    });

    const manifest = JSON.parse(
      await readFile(join(workspace, persisted.artifactPath), 'utf8'),
    ) as {
      schemaVersion: string;
      blocks: Record<string, string>;
      elementStates?: string;
      decisions?: unknown;
      useCases?: unknown;
      contract?: unknown;
    };
    assert.equal(persisted.input.contract.title, 'Task API');
    assert.equal(manifest.schemaVersion, 'living-design/v7');
    assert.equal(manifest.elementStates, undefined);
    assert.equal(
      persisted.input.useCases[0]?.implementationState,
      'planned',
    );
    assert.equal(
      'implementationState' in persisted.input.contract.interactions[0]!,
      false,
    );
    assert.equal(
      'implementationState' in persisted.input.useCases[0]!.steps[0]!,
      false,
    );
    assert.equal(manifest.blocks.useCases, join('blocks', 'use-case.json'));
    assert.equal(manifest.blocks.contract, join('blocks', 'contract.json'));
    assert.equal(manifest.decisions, undefined);
    assert.deepEqual(
      persisted.input.contract.interactions[0]?.attention,
      [attentionItem],
    );
    await artifacts.updateImplementationStates([{
      perspective: 'use-case',
      elementId: 'capture-task',
      implementationState: 'implemented',
    }]);
    assert.equal(
      (await artifacts.loadCurrent())?.input.useCases[0]?.implementationState,
      'implemented',
    );
    assert.equal(manifest.useCases, undefined);
    assert.equal(manifest.contract, undefined);
    const notesPath = join(
      workspace,
      '.tandem',
      'living-canvas',
      'design',
      'notes.md',
    );
    const notes = await readFile(notesPath, 'utf8');
    assert.match(notes, /^# Design notes\n\n## \d{4}-/);
    assert.match(notes, /- Created the initial task-service design\./);
    assert.match(notes, /- Task IDs remain an open contract choice\./);
    const changesPath = join(
      workspace,
      '.tandem',
      'living-canvas',
      'design',
      'changes.md',
    );
    await assert.rejects(access(changesPath), { code: 'ENOENT' });
    await writeFile(
      changesPath,
      '# Design changes\n\n## legacy\n\n- Preserved legacy change.\n',
    );
    const consolidated = await artifacts.loadCurrent();
    assert.ok(consolidated?.notes.includes('Preserved legacy change.'));
    assert.match(await readFile(notesPath, 'utf8'), /## Imported change history/);
    assert.match(await readFile(notesPath, 'utf8'), /- Preserved legacy change\./);
    await assert.rejects(access(changesPath), { code: 'ENOENT' });
    await assert.rejects(
      access(join(workspace, '.tandem', 'living-canvas', '.staging', 'design-1')),
      { code: 'ENOENT' },
    );
  } finally {
    await closeHostStateWal(workspace); await rm(workspace, { recursive: true, force: true });
  }
});

test('normalizes legacy blocked and stale Use-case states to in-progress', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'living-canvas-lifecycle-'));
  try {
    const artifacts = new BackboneArtifactStore(workspace);
    await artifacts.writeBlock('design', 'useCases', proposal.useCases);
    await artifacts.writeBlock('design', 'contract', proposal.contract);
    await artifacts.writeBlock('design', 'controlFlows', proposal.controlFlows);
    await artifacts.writeBlock('design', 'guiSketches', proposal.guiSketches);
    await artifacts.writeBlock('design', 'systemStacks', proposal.systemStacks);
    const persisted = await artifacts.conclude('design', 'request', {
      goal: proposal.goal,
      summary: proposal.summary,
      aspects: proposal.aspects,
    });
    const useCasePath = join(
      workspace,
      dirname(persisted.artifactPath),
      'blocks',
      'use-case.json',
    );
    const useCases = JSON.parse(await readFile(useCasePath, 'utf8'));
    useCases[0].implementationState = 'blocked';
    useCases[1].implementationState = 'stale';
    await writeFile(useCasePath, `${JSON.stringify(useCases, null, 2)}\n`);

    const restored = await new BackboneArtifactStore(workspace).loadCurrent();
    const stored = JSON.parse(await readFile(useCasePath, 'utf8'));

    assert.deepEqual(
      restored?.input.useCases.map(({ implementationState }) =>
        implementationState),
      ['in-progress', 'in-progress'],
    );
    assert.deepEqual(
      stored.map(({ implementationState }: { implementationState: string }) =>
        implementationState),
      ['in-progress', 'in-progress'],
    );
  } finally {
    await closeHostStateWal(workspace); await rm(workspace, { recursive: true, force: true });
  }
});

test('LC-003 deduplicates conclusion and revision notes by exact string in first-seen order', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'living-canvas-note-dedup-'));
  try {
    const initialNotes = ['First note.', 'First note.', ' First note.', 'first note.'];
    const { artifacts, original, notesPath } = await createNoteDesign(workspace, initialNotes);
    const originalSummary = structuredClone(original.reviewSummaries[0]);
    assert.deepEqual(original.notes, ['First note.', ' First note.', 'first note.']);
    assert.deepEqual(initialNotes, ['First note.', 'First note.', ' First note.', 'first note.']);

    const baseline = await artifacts.beginRevision('revision', original.artifactPath);
    const revised = await artifacts.conclude('revision', 'request-revision', {
      goal: proposal.goal,
      summary: proposal.summary,
      aspects: proposal.aspects,
      notes: ['First note.', 'Next note.', 'Next note.', ' First note.'],
      reviewSummary,
    }, baseline);
    const restored = await new BackboneArtifactStore(workspace).loadCurrent();
    assert.deepEqual(revised.notes, ['First note.', ' First note.', 'first note.', 'Next note.']);
    assert.deepEqual(restored?.notes, revised.notes);
    assert.equal(restored?.reviewSummaries.length, 2);
    assert.deepEqual(restored?.reviewSummaries[0], originalSummary);
    assert.deepEqual(restored?.reviewSummaries[1], {
      ...reviewSummary,
      proposalId: revised.id,
      reviewedAt: revised.proposedAt,
      kind: 'revision',
    });
    assert.deepEqual(
      (await readFile(notesPath, 'utf8')).split(/\r?\n/).filter((line) => line.startsWith('- ')),
      ['- First note.', '- First note.', '- first note.', '- Next note.'],
    );

    await artifacts.beginRevision('repeat', original.artifactPath);
    const repeated = await artifacts.conclude('repeat', 'request-repeat', {
      goal: proposal.goal,
      summary: 'A revision repeating only existing notes.',
      aspects: proposal.aspects,
      notes: revised.notes,
      reviewSummary,
    }, revised.id);
    assert.deepEqual(repeated.notes, revised.notes);
    assert.equal(repeated.reviewSummaries.length, 3);
    assert.deepEqual(repeated.reviewSummaries.slice(0, 2), revised.reviewSummaries);
    assert.equal((await readFile(notesPath, 'utf8')).split(/\r?\n/).filter((line) =>
      line.startsWith('- ')).length, 4);
  } finally {
    await closeHostStateWal(workspace); await rm(workspace, { recursive: true, force: true });
  }
});

for (const version of [1, 2, 3, 4, 5, 6, 7]) {
  test(`LC-003 normalizes duplicate notes when loading living-design/v${version}`, async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'living-canvas-note-migration-'));
    try {
      const { original, manifestPath, notesPath } = await createNoteDesign(
        workspace,
        ['First note.', 'Second note.'],
      );
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      manifest.schemaVersion = `living-design/v${version}`;
      manifest.notes = ['First note.', 'First note.', 'Second note.', 'First note.'];
      if (version < 3) {
        manifest.decisions = [];
        manifest.attentionCandidates = {};
        manifest.attentionDispositions = {};
        delete manifest.reviewSummaries;
      }
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      const marker = `<!-- tandem-application:${original.id} -->`;
      await writeFile(notesPath, [
        '# Design notes',
        '',
        '## Initial notes',
        '',
        '- First note.',
        '- First note.',
        '- Second note.',
        '',
        marker,
        '## Revision notes',
        '',
        '- First note.',
        '- Pending checkpoint note.',
        '',
      ].join('\n'));

      const restored = await new BackboneArtifactStore(workspace).loadCurrent();
      const stored = JSON.parse(await readFile(manifestPath, 'utf8'));
      const normalizedText = await readFile(notesPath, 'utf8');
      assert.deepEqual(restored?.notes, ['First note.', 'Second note.']);
      assert.deepEqual(stored.notes, restored?.notes);
      assert.equal(stored.schemaVersion, 'living-design/v7');
      assert.deepEqual(stored.reviewSummaries, version < 3 ? [] : original.reviewSummaries);
      assert.deepEqual(
        normalizedText.split(/\r?\n/).filter((line) => line.startsWith('- ')),
        ['- First note.', '- Second note.', '- Pending checkpoint note.'],
      );
      assert.ok(normalizedText.includes(marker));
      assert.ok(normalizedText.includes('## Initial notes'));
      assert.ok(normalizedText.includes('## Revision notes'));
      const manifestText = await readFile(manifestPath, 'utf8');
      await new BackboneArtifactStore(workspace).loadCurrent();
      assert.equal(await readFile(manifestPath, 'utf8'), manifestText);
      assert.equal(await readFile(notesPath, 'utf8'), normalizedText);
    } finally {
      await closeHostStateWal(workspace); await rm(workspace, { recursive: true, force: true });
    }
  });
}

test('LC-003 deduplicates legacy change imports on load, repeated import, and revision', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'living-canvas-note-import-'));
  try {
    const { artifacts, original, notesPath, changesPath } = await createNoteDesign(
      workspace,
      ['Existing note.'],
    );
    const importedText = '# Design changes\n\n- Existing note.\n- Imported note.\n- Imported note.\n';
    await writeFile(changesPath, importedText);
    const loaded = await artifacts.loadCurrent();
    assert.deepEqual(loaded?.notes, ['Existing note.', 'Imported note.']);
    assert.deepEqual(loaded?.reviewSummaries, original.reviewSummaries);
    await assert.rejects(access(changesPath), { code: 'ENOENT' });
    const firstText = await readFile(notesPath, 'utf8');
    assert.ok(firstText.includes('## Imported change history'));
    await writeFile(changesPath, importedText);
    assert.deepEqual((await artifacts.loadCurrent())?.notes, loaded?.notes);
    assert.equal(await readFile(notesPath, 'utf8'), firstText);
    await assert.rejects(access(changesPath), { code: 'ENOENT' });

    await artifacts.beginRevision('revision', original.artifactPath);
    await writeFile(changesPath, '# Design changes\n\n- Imported note.\n- New note.\n- New note.\n-  New note.\n');
    const revised = await artifacts.conclude('revision', 'request-revision', {
      goal: proposal.goal,
      summary: 'Consolidated imported and revision notes.',
      aspects: proposal.aspects,
      notes: ['New note.', 'Last note.', 'Last note.'],
      reviewSummary,
    }, original.id);
    assert.deepEqual(revised.notes, ['Existing note.', 'Imported note.', 'New note.', ' New note.', 'Last note.']);
    assert.deepEqual(
      (await readFile(notesPath, 'utf8')).split(/\r?\n/).filter((line) => line.startsWith('- ')),
      ['- Existing note.', '- Imported note.', '- New note.', '- New note.', '- Last note.'],
    );
    assert.deepEqual((await new BackboneArtifactStore(workspace).loadCurrent())?.notes, revised.notes);
    assert.deepEqual(revised.reviewSummaries[0], original.reviewSummaries[0]);
    assert.equal(revised.reviewSummaries.length, 2);
    await assert.rejects(access(changesPath), { code: 'ENOENT' });
  } finally {
    await closeHostStateWal(workspace); await rm(workspace, { recursive: true, force: true });
  }
});

test('does not duplicate checkpointed revision notes during application replay', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'living-canvas-note-replay-'));
  try {
    const artifacts = new BackboneArtifactStore(workspace);
    for (const [name, value] of Object.entries({
      useCases: proposal.useCases,
      contract: proposal.contract,
      controlFlows: proposal.controlFlows,
      guiSketches: proposal.guiSketches,
      systemStacks: proposal.systemStacks,
    })) {
      await artifacts.writeBlock(
        'initial',
        name as BackboneBlockName,
        value as never,
      );
    }
    const original = await artifacts.conclude('initial', 'request-initial', {
      goal: proposal.goal,
      summary: proposal.summary,
      aspects: proposal.aspects,
    });
    await artifacts.beginRevision('revision-replay', original.artifactPath);
    const application = {
      id: 'replayed-application',
      proposedAt: '2026-01-02T03:04:05.000Z',
      conclusion: {
        goal: proposal.goal,
        summary: 'Checkpointed revision.',
        aspects: proposal.aspects,
        notes: [
          proposal.summary,
          `${proposal.summary} `,
          'Replay this note exactly once.',
          'Replay this note exactly once.',
        ],
      },
    };
    const notesPath = join(
      workspace,
      '.tandem',
      'living-canvas',
      'design',
      'notes.md',
    );
    await writeFile(
      notesPath,
      `${await readFile(notesPath, 'utf8')}\n<!-- tandem-application:${application.id} -->\n## ${application.proposedAt}\n\n- ${proposal.summary}\n- Replay this note exactly once.\n- Replay this note exactly once.\n`,
      'utf8',
    );
    const checkpointedText = await readFile(notesPath, 'utf8');
    await new BackboneArtifactStore(workspace).loadCurrent();
    assert.equal(await readFile(notesPath, 'utf8'), checkpointedText);

    const replayed = await artifacts.conclude(
      'revision-replay',
      'request-revision',
      application.conclusion,
      original.id,
      undefined,
      application,
    );

    const notes = await readFile(notesPath, 'utf8');
    assert.equal(
      notes.match(/<!-- tandem-application:replayed-application -->/g)?.length,
      1,
    );
    assert.equal(
      notes.match(/Replay this note exactly once\./g)?.length,
      1,
    );
    assert.equal(notes.split(/\r?\n/).filter((line) => line === `- ${proposal.summary}`).length, 2);
    assert.deepEqual(
      notes.split(/\r?\n/).filter((line) => line.startsWith('- ')),
      [`- ${proposal.summary}`, `- ${proposal.summary}`, '- Replay this note exactly once.'],
    );
    assert.deepEqual(replayed.notes, [
      proposal.summary,
      `${proposal.summary} `,
      'Replay this note exactly once.',
    ]);
    const restored = await new BackboneArtifactStore(workspace).loadCurrent();
    assert.deepEqual(restored?.notes, replayed.notes);
    assert.equal(await readFile(notesPath, 'utf8'), notes);
  } finally {
    await closeHostStateWal(workspace); await rm(workspace, { recursive: true, force: true });
  }
});

test('inherits unchanged blocks and resolves Attention by removing it from its entity', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'living-canvas-revision-'));
  try {
    const artifacts = new BackboneArtifactStore(workspace);
    await artifacts.writeBlock('original', 'useCases', proposal.useCases);
    await artifacts.writeBlock('original', 'contract', proposal.contract);
    await artifacts.writeBlock('original', 'controlFlows', proposal.controlFlows);
    await artifacts.writeBlock('original', 'guiSketches', proposal.guiSketches);
    await artifacts.writeBlock('original', 'systemStacks', proposal.systemStacks);
    const original = await artifacts.conclude('original', 'request-original', {
      goal: proposal.goal,
      summary: proposal.summary,
      aspects: proposal.aspects,
    });

    const previousId = await artifacts.beginRevision('feedback', original.artifactPath);
    assert.equal(previousId, original.id);
    await artifacts.writeBlock(
      'feedback',
      'contract',
      {
        ...proposal.contract,
        interactions: proposal.contract.interactions.map((interaction) =>
          interaction.id === 'create-task'
            ? { ...interaction, attention: [] }
            : interaction),
      },
    );
    const revised = await artifacts.conclude(
      'feedback',
      'request-original',
      {
        goal: proposal.goal,
        summary: 'The server now owns task identifiers.',
        aspects: proposal.aspects,
      },
      original.id,
    );
    const manifest = JSON.parse(
      await readFile(join(workspace, revised.artifactPath), 'utf8'),
    ) as { schemaVersion: string; decisions?: unknown };

    assert.deepEqual(revised.input.useCases, original.input.useCases);
    assert.deepEqual(revised.input.controlFlows, original.input.controlFlows);
    assert.deepEqual(collectAttentionItems(revised.input), []);
    assert.equal(manifest.schemaVersion, 'living-design/v7');
    assert.equal(manifest.decisions, undefined);
    assert.equal(revised.artifactPath, original.artifactPath);
    await assert.rejects(
      access(join(workspace, dirname(revised.artifactPath), 'attention-dispositions')),
      { code: 'ENOENT' },
    );
  } finally {
    await closeHostStateWal(workspace); await rm(workspace, { recursive: true, force: true });
  }
});

test('migrates v2 manifest decisions into their design entities', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'living-canvas-v2-'));
  try {
    const artifacts = new BackboneArtifactStore(workspace);
    await artifacts.writeBlock('original', 'useCases', proposal.useCases);
    await artifacts.writeBlock('original', 'contract', proposal.contract);
    await artifacts.writeBlock('original', 'controlFlows', []);
    await artifacts.writeBlock('original', 'guiSketches', []);
    await artifacts.writeBlock('original', 'systemStacks', []);
    const original = await artifacts.conclude('original', 'request-original', {
      goal: proposal.goal,
      summary: proposal.summary,
      aspects: proposal.aspects,
    });
    const manifestPath = join(workspace, original.artifactPath);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >;
    const designDirectory = dirname(manifestPath);
    const contractPath = join(designDirectory, 'blocks', 'contract.json');
    const contract = JSON.parse(
      await readFile(contractPath, 'utf8'),
    ) as typeof proposal.contract;
    delete contract.interactions[0]?.attention;
    await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
    await mkdir(join(designDirectory, 'attention-candidates'), { recursive: true });
    await mkdir(join(designDirectory, 'attention-dispositions'), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify({
      ...manifest,
      schemaVersion: 'living-design/v2',
      decisions: [legacyAttentionItem],
      attentionCandidates: {},
      attentionDispositions: {},
    }, null, 2)}\n`);

    const migrated = await new BackboneArtifactStore(workspace).loadCurrent();
    assert.deepEqual(
      migrated?.input.contract.interactions[0]?.attention,
      [attentionItem],
    );
    assert.equal(
      JSON.parse(await readFile(manifestPath, 'utf8')).schemaVersion,
      'living-design/v7',
    );
    await access(join(designDirectory, 'attention-candidates'));
    await access(join(designDirectory, 'attention-dispositions'));
  } finally {
    await closeHostStateWal(workspace); await rm(workspace, { recursive: true, force: true });
  }
});

test('migrates v3 by retaining coarse Use case state and removing step state', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'living-canvas-v3-'));
  try {
    const artifacts = new BackboneArtifactStore(workspace);
    await artifacts.writeBlock('original', 'useCases', proposal.useCases);
    await artifacts.writeBlock('original', 'contract', proposal.contract);
    await artifacts.writeBlock('original', 'controlFlows', []);
    await artifacts.writeBlock('original', 'guiSketches', []);
    await artifacts.writeBlock('original', 'systemStacks', []);
    const original = await artifacts.conclude('original', 'request-original', {
      goal: proposal.goal,
      summary: proposal.summary,
      aspects: proposal.aspects,
    });
    const manifestPath = join(workspace, original.artifactPath);
    const designDirectory = dirname(manifestPath);
    const useCasePath = join(designDirectory, 'blocks', 'use-case.json');
    const useCases = JSON.parse(
      await readFile(useCasePath, 'utf8'),
    ) as Array<Record<string, unknown>>;
    useCases[0]!.implementationState = 'verified';
    (useCases[0]!.steps as Array<Record<string, unknown>>)[0]!
      .implementationState = 'implemented';
    await writeFile(useCasePath, `${JSON.stringify(useCases, null, 2)}\n`);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, `${JSON.stringify({
      ...manifest,
      schemaVersion: 'living-design/v3',
    }, null, 2)}\n`);

    const migrated = await new BackboneArtifactStore(workspace).loadCurrent();

    assert.equal(migrated!.input.useCases[0]!.implementationState, 'implemented');
    assert.equal(
      'implementationState' in migrated!.input.useCases[0]!.steps[0]!,
      false,
    );
    assert.equal(
      JSON.parse(await readFile(manifestPath, 'utf8')).schemaVersion,
      'living-design/v7',
    );
  } finally {
    await closeHostStateWal(workspace); await rm(workspace, { recursive: true, force: true });
  }
});

test('migrates v6 mixed entity progress into top-level Use cases', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'living-canvas-v6-progress-'));
  try {
    const artifacts = new BackboneArtifactStore(workspace);
    await artifacts.writeBlock('original', 'useCases', proposal.useCases);
    await artifacts.writeBlock('original', 'contract', proposal.contract);
    await artifacts.writeBlock('original', 'controlFlows', []);
    await artifacts.writeBlock('original', 'guiSketches', []);
    await artifacts.writeBlock('original', 'systemStacks', []);
    const original = await artifacts.conclude('original', 'request-original', {
      goal: proposal.goal,
      summary: proposal.summary,
      aspects: proposal.aspects,
    });
    const manifestPath = join(workspace, original.artifactPath);
    const designDirectory = dirname(manifestPath);
    const useCasePath = join(designDirectory, 'blocks', 'use-case.json');
    const contractPath = join(designDirectory, 'blocks', 'contract.json');
    const flowPath = join(designDirectory, 'blocks', 'flow.json');
    const useCases = JSON.parse(
      await readFile(useCasePath, 'utf8'),
    ) as Array<Record<string, unknown>>;
    delete useCases[0]!.implementationState;
    delete useCases[1]!.implementationState;
    (useCases[0]!.steps as Array<Record<string, unknown>>)[0]!
      .implementationState = 'implemented';
    const contract = JSON.parse(
      await readFile(contractPath, 'utf8'),
    ) as { interactions: Array<Record<string, unknown>> };
    contract.interactions[0]!.implementationState = 'verified';
    await writeFile(flowPath, `${JSON.stringify([{
      id: 'review-flow',
      title: 'Review tasks',
      purpose: 'Load the current task list.',
      useCaseIds: ['review-tasks'],
      nodes: [{
        id: 'review-start',
        label: 'Open list',
        kind: 'start',
        contractKind: 'none',
        contractId: '',
        implementationState: 'implemented',
      }, {
        id: 'review-visible',
        label: 'Show list',
        kind: 'outcome',
        contractKind: 'none',
        contractId: '',
      }],
      edges: [{
        id: 'review-shows-list',
        fromNodeId: 'review-start',
        toNodeId: 'review-visible',
        label: 'show',
      }],
    }], null, 2)}\n`);
    await writeFile(useCasePath, `${JSON.stringify(useCases, null, 2)}\n`);
    await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, `${JSON.stringify({
      ...manifest,
      schemaVersion: 'living-design/v6',
      aspects: [
        ...proposal.aspects,
        {
          id: 'review-flow-aspect',
          kind: 'control-flow',
          title: 'Review flow',
          summary: 'Shows the task review sequence.',
          relatedElements: ['review-tasks'],
        },
      ],
    }, null, 2)}\n`);

    const migrated = await new BackboneArtifactStore(workspace).loadCurrent();

    assert.equal(
      migrated!.input.useCases.find(({ id }) => id === 'capture-task')
        ?.implementationState,
      'implemented',
    );
    assert.equal(
      migrated!.input.useCases.find(({ id }) => id === 'review-tasks')
        ?.implementationState,
      'implemented',
    );
    assert.equal(
      'implementationState' in migrated!.input.useCases[0]!.steps[0]!,
      false,
    );
    assert.equal(
      'implementationState' in migrated!.input.contract.interactions[0]!,
      false,
    );
    assert.equal(
      JSON.parse(await readFile(manifestPath, 'utf8')).schemaVersion,
      'living-design/v7',
    );
  } finally {
    await closeHostStateWal(workspace); await rm(workspace, { recursive: true, force: true });
  }
});

test('migrates v5 by removing lifecycle state from every Flow element', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'living-canvas-v5-flow-'));
  try {
    const flow = {
      id: 'list-task-flow',
      title: 'List tasks',
      purpose: 'Load and show the current task list.',
      useCaseIds: ['review-tasks'],
      nodes: [
        {
          id: 'list-start',
          label: 'Open task list',
          kind: 'start' as const,
          contractKind: 'none' as const,
          contractId: '',
        },
        {
          id: 'list-query',
          label: 'Load tasks',
          kind: 'interaction' as const,
          contractKind: 'interaction' as const,
          contractId: 'list-tasks',
        },
        {
          id: 'list-visible',
          label: 'Show tasks',
          kind: 'outcome' as const,
          contractKind: 'none' as const,
          contractId: '',
        },
      ],
      edges: [
        {
          id: 'start-query',
          fromNodeId: 'list-start',
          toNodeId: 'list-query',
          label: 'open',
        },
        {
          id: 'query-visible',
          fromNodeId: 'list-query',
          toNodeId: 'list-visible',
          label: 'loaded',
        },
      ],
    };
    const aspects = [
      ...proposal.aspects,
      {
        id: 'task-flow',
        kind: 'control-flow' as const,
        title: 'Task flow',
        summary: 'Shows the task-list query path.',
        relatedElements: ['list-tasks'],
      },
    ];
    const artifacts = new BackboneArtifactStore(workspace);
    await artifacts.writeBlock('original', 'useCases', proposal.useCases);
    await artifacts.writeBlock('original', 'contract', proposal.contract);
    await artifacts.writeBlock('original', 'controlFlows', [flow]);
    await artifacts.writeBlock('original', 'guiSketches', []);
    await artifacts.writeBlock('original', 'systemStacks', []);
    const original = await artifacts.conclude('original', 'request-original', {
      goal: proposal.goal,
      summary: proposal.summary,
      aspects,
    });
    const manifestPath = join(workspace, original.artifactPath);
    const designDirectory = dirname(manifestPath);
    const flowPath = join(designDirectory, 'blocks', 'flow.json');
    const flows = JSON.parse(
      await readFile(flowPath, 'utf8'),
    ) as Array<Record<string, unknown>>;
    flows[0]!.implementationState = 'verified';
    const persistedFlow = flows[0] as {
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    };
    persistedFlow.nodes[0]!.implementationState = 'implemented';
    persistedFlow.edges[0]!.implementationState = 'in-progress';
    await writeFile(flowPath, `${JSON.stringify(flows, null, 2)}\n`);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, `${JSON.stringify({
      ...manifest,
      schemaVersion: 'living-design/v5',
    }, null, 2)}\n`);

    const migratedStore = new BackboneArtifactStore(workspace);
    const migrated = await migratedStore.loadCurrent();
    const migratedFlow = migrated!.input.controlFlows[0]!;

    assert.equal('implementationState' in migratedFlow, false);
    assert.equal(
      [...migratedFlow.nodes, ...migratedFlow.edges].every((entity) =>
        !('implementationState' in entity)),
      true,
    );
    assert.equal(
      JSON.parse(await readFile(manifestPath, 'utf8')).schemaVersion,
      'living-design/v7',
    );
    await assert.rejects(
      migratedStore.updateImplementationStates([{
        perspective: 'flow',
        elementId: 'list-task-flow',
        implementationState: 'implemented',
      }]),
      /Only top-level Use cases carry implementation lifecycle state/,
    );
  } finally {
    await closeHostStateWal(workspace); await rm(workspace, { recursive: true, force: true });
  }
});

test('refuses implicit mutation of a legacy design without verified WAL migration', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'living-canvas-legacy-'));
  try {
    const legacyDirectory = join(
      workspace,
      '.tandem',
      'living-canvas',
      'backbones',
      'legacy-request',
    );
    const blocks = {
      useCases: join('blocks', 'use-case.json'),
      contract: join('blocks', 'contract.json'),
      controlFlows: join('blocks', 'flow.json'),
      guiSketches: join('blocks', 'gui.json'),
      systemStacks: join('blocks', 'system.json'),
    };
    const candidates = {
      useCases: join('attention-candidates', 'use-case.json'),
      contract: join('attention-candidates', 'contract.json'),
      controlFlows: join('attention-candidates', 'flow.json'),
      guiSketches: join('attention-candidates', 'gui.json'),
      systemStacks: join('attention-candidates', 'system.json'),
    };
    await Promise.all([
      ...Object.entries(blocks).map(async ([name, path]) => {
        await mkdir(dirname(join(legacyDirectory, path)), { recursive: true });
        const block = structuredClone(proposal[name as keyof typeof blocks]);
        if (name === 'contract') {
          delete (block as typeof proposal.contract).interactions[0]?.attention;
        }
        await writeFile(
          join(legacyDirectory, path),
          `${JSON.stringify(block, null, 2)}\n`,
        );
      }),
      ...Object.entries(candidates).map(async ([name, path]) => {
        await mkdir(dirname(join(legacyDirectory, path)), { recursive: true });
        await writeFile(
          join(legacyDirectory, path),
          `${JSON.stringify(name === 'contract' ? [legacyAttentionItem] : [], null, 2)}\n`,
        );
      }),
    ]);
    await writeFile(
      join(legacyDirectory, 'proposal.json'),
      `${JSON.stringify({
        id: 'legacy-proposal',
        requestId: 'legacy-request',
        proposedAt: '2026-08-27T10:59:05.436Z',
        goal: proposal.goal,
        summary: proposal.summary,
        aspects: proposal.aspects,
        decisions: [legacyAttentionItem],
        blocks,
        attentionCandidates: candidates,
      }, null, 2)}\n`,
    );

    const retained = await readFile(join(legacyDirectory, 'proposal.json'), 'utf8');
    await assert.rejects(new BackboneArtifactStore(workspace).loadCurrent(),
      /requires explicitly verified quiescent WAL migration/);
    assert.equal(await readFile(join(legacyDirectory, 'proposal.json'), 'utf8'), retained);
    await assert.rejects(
      access(join(workspace, '.tandem', 'living-canvas', 'design', 'changes.md')),
      { code: 'ENOENT' },
    );
    await assert.rejects(access(join(workspace, '.tandem', 'living-canvas', 'design', 'manifest.json')),
      { code: 'ENOENT' });
  } finally {
    await closeHostStateWal(workspace); await rm(workspace, { recursive: true, force: true });
  }
});

test('cannot conclude before every perspective block is persisted', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'living-canvas-blocks-'));
  try {
    const artifacts = new BackboneArtifactStore(workspace);
    await artifacts.writeBlock('design-2', 'useCases', proposal.useCases);

    await assert.rejects(
      artifacts.conclude('design-2', 'request-2', {
        goal: proposal.goal,
        summary: proposal.summary,
        aspects: proposal.aspects,
      }),
      /Backbone block contract has not been submitted/,
    );
  } finally {
    await closeHostStateWal(workspace); await rm(workspace, { recursive: true, force: true });
  }
});

test('summarizes only implementation files', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'living-canvas-review-trigger-'));
  try {
    await mkdir(join(workspace, 'src'), { recursive: true });
    await mkdir(join(workspace, '.tandem'), { recursive: true });
    await writeFile(join(workspace, 'src', 'task.ts'), 'export const task = 1;\n');
    await writeFile(join(workspace, 'expected-output.txt'), 'before\n');
    await writeFile(join(workspace, 'notes.md'), '# ignored\n');
    await writeFile(join(workspace, '.tandem', 'state.json'), '{}\n');
    const tracker = new WorkspaceImplementationFileTracker(workspace);
    const before = await tracker.snapshot();

    await writeFile(join(workspace, 'src', 'task.ts'), 'export const task = 2;\n');
    await writeFile(join(workspace, 'src', 'list.ts'), 'export const list = [];\n');
    await writeFile(join(workspace, 'expected-output.txt'), 'after\n');
    await writeFile(join(workspace, 'notes.md'), '# still ignored\n');
    await writeFile(join(workspace, '.tandem', 'state.json'), '{"changed":true}\n');
    const changes = tracker.summarize(before, await tracker.snapshot());

    assert.deepEqual(changes.changedFiles, [
      'expected-output.txt',
      join('src', 'list.ts'),
      join('src', 'task.ts'),
    ]);
    assert.equal(
      changes.details.find(({ path }) => path === join('src', 'task.ts'))?.changedBytes,
      2,
    );
    await writeFile(join(workspace, 'src', 'temporary.ts'), 'export const temporary = true;\n');
    const beforeDeletion = await tracker.snapshot();
    await rm(join(workspace, 'src', 'temporary.ts'));
    const deleted = tracker.summarize(beforeDeletion, await tracker.snapshot());
    assert.match(
      deleted.details[0]?.beforeExcerpt ?? '',
      /temporary = true/,
    );
  } finally {
    await closeHostStateWal(workspace); await rm(workspace, { recursive: true, force: true });
  }
});

test('tracks README deliverables without tracking review indexes or general Markdown', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'living-canvas-readme-review-'));
  try {
    await mkdir(join(workspace, 'case-app'));
    const path = join('case-app', 'README.md');
    const tracker = new WorkspaceImplementationFileTracker(workspace);
    const empty = await tracker.snapshot();
    await writeFile(join(workspace, path), '# Task API\n');
    await writeFile(join(workspace, 'readme.md'), '# Workspace\n');
    await writeFile(join(workspace, 'TANDEM.md'), '# Review index\n');
    await writeFile(join(workspace, 'case-app', 'TANDEM.md'), '# Legacy index\n');
    await writeFile(join(workspace, 'notes.md'), '# Internal notes\n');
    const added = await tracker.snapshot();
    assert.deepEqual([...added.keys()].sort(), [path, 'readme.md']);
    assert.deepEqual(tracker.summarize(empty, added).addedFiles, [path, 'readme.md']);
    await writeFile(join(workspace, path), '# Task API\nRun: node server.js\n');
    const modified = await tracker.snapshot();
    const changes = tracker.summarize(added, modified);
    assert.deepEqual(changes.modifiedFiles, [path]);
    assert.match(changes.details[0]?.afterExcerpt ?? '', /Run: node server.js/);
    await rm(join(workspace, path));
    assert.deepEqual(tracker.summarize(modified, await tracker.snapshot()).deletedFiles, [path]);
  } finally {
    await closeHostStateWal(workspace); await rm(workspace, { recursive: true, force: true });
  }
});

test('expands a first implementation review to the complete workspace', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'living-canvas-review-bootstrap-'));
  try {
    await mkdir(join(workspace, 'src'), { recursive: true });
    await writeFile(join(workspace, 'src', 'existing.ts'), 'export const existing = true;\n');
    const tracker = new WorkspaceImplementationFileTracker(workspace);
    const before = await tracker.snapshot();
    await writeFile(join(workspace, 'src', 'new.ts'), 'export const added = true;\n');
    const after = await tracker.snapshot();
    const turnChanges = tracker.summarize(before, after);

    const expanded = expandImplementationReviewToWorkspace(turnChanges, after);

    assert.equal(expanded.reviewScope, 'workspace-bootstrap');
    assert.deepEqual(expanded.changedFiles, [
      join('src', 'existing.ts'),
      join('src', 'new.ts'),
    ]);
    assert.deepEqual(expanded.addedFiles, [join('src', 'new.ts')]);
    assert.deepEqual(expanded.details.map(({ path }) => path), [join('src', 'new.ts')]);
  } finally {
    await closeHostStateWal(workspace); await rm(workspace, { recursive: true, force: true });
  }
});

test('validates evidence and attaches implementation-review Attention', () => {
  const changes: ImplementationChangeSummary = {
    addedFiles: [],
    modifiedFiles: ['src\\list-tasks.ts'],
    deletedFiles: [],
    changedFiles: ['src\\list-tasks.ts'],
    changedBytes: 240,
    details: [{
      path: 'src\\list-tasks.ts',
      kind: 'modified',
      changedBytes: 240,
      beforeExcerpt: 'return tasks;',
      afterExcerpt: 'return tasks.sort(newestFirst);',
      excerptTruncated: false,
    }],
  };

  validateImplementationReviewResult(implementationReviewResult, proposal, changes);
  const updated = applyImplementationReviewFindings(
    proposal,
    implementationReviewResult.findings,
  ).input;

  assert.equal(
    collectAttentionItems(updated).find(({ id }) => id === 'task-ordering')?.context.elementId,
    'list-tasks',
  );
  assert.throws(
    () => validateImplementationReviewResult(
      {
        ...implementationReviewResult,
        findings: [{
          ...implementationReviewResult.findings[0]!,
          evidence: [{
            path: 'src\\unchanged.ts',
            observation: 'This file was not changed by the reviewed turn.',
          }],
        }],
      },
      proposal,
      changes,
    ),
    /must cite a changed implementation file/,
  );
});

test('reserves verified reconciliation for post-implementation review', () => {
  const statefulProposal = structuredClone(proposal);
  statefulProposal.useCases.find(({ id }) => id === 'review-tasks')!
    .implementationState = 'in-progress';
  const result = {
    status: 'consistent',
    summary: 'The changed query now satisfies the list contract.',
    findings: [],
    stateUpdates: [{
      perspective: 'use-case',
      elementId: 'review-tasks',
      currentState: 'in-progress',
      recommendedState: 'verified',
      rationale: 'The query behavior appears complete.',
      evidence: [{
        path: 'src\\list-tasks.ts',
        observation: 'The changed query implements the designed list behavior.',
      }],
    }],
  } as unknown as ImplementationReviewResult;
  const changes: ImplementationChangeSummary = {
    addedFiles: [],
    modifiedFiles: ['src\\list-tasks.ts'],
    deletedFiles: [],
    changedFiles: ['src\\list-tasks.ts'],
    changedBytes: 120,
    details: [{
      path: 'src\\list-tasks.ts',
      kind: 'modified',
      changedBytes: 120,
      afterExcerpt: 'return tasks;',
      excerptTruncated: false,
    }],
  };

  assert.throws(
    () => validateImplementationReviewResult(
      result,
      statefulProposal,
      changes,
    ),
    /cannot set verified during implementation/,
  );
});

test('promotes implementation state without renaming the watched design directory', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'living-canvas-review-promotion-'));
  try {
    const artifacts = new BackboneArtifactStore(workspace);
    await artifacts.writeBlock('design', 'useCases', proposal.useCases);
    await artifacts.writeBlock('design', 'contract', proposal.contract);
    await artifacts.writeBlock('design', 'controlFlows', proposal.controlFlows);
    await artifacts.writeBlock('design', 'guiSketches', proposal.guiSketches);
    await artifacts.writeBlock('design', 'systemStacks', proposal.systemStacks);
    await artifacts.conclude('design', 'request', {
      goal: proposal.goal,
      summary: proposal.summary,
      aspects: proposal.aspects,
    });
    const designDirectory = join(
      workspace,
      '.tandem',
      'living-canvas',
      'design',
    );
    await mkdir(designDirectory, { recursive: true });
    const watchedDirectory = await opendir(designDirectory);
    try {
      await artifacts.updateImplementationStates([{
        perspective: 'use-case',
        elementId: 'review-tasks',
        implementationState: 'in-progress',
      }]);
    } finally {
      await watchedDirectory.close();
    }
    const restored = await new BackboneArtifactStore(workspace).loadCurrent();
    assert.equal(
      restored!.input.useCases.find(({ id }) => id === 'review-tasks')
        ?.implementationState,
      'in-progress',
    );
  } finally {
    await closeHostStateWal(workspace); await rm(workspace, { recursive: true, force: true });
  }
});
