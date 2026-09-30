import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { readFile, writeFile } from './helpers/host-state-fixture.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { closeHostStateWal } from '../../runtime-src/domain/host-state-wal.ts';
import { decodeRecord, encodeRecord } from '../../runtime-src/domain/workflow/foundation-storage.ts';
import { ProjectPolicyStore } from '../../runtime-src/domain/workflow/project-policy-store.ts';
import { createPolicyGeneration } from '../../runtime-src/domain/workflow/policy-contracts.ts';
import { DEFAULT_POLICY, parsePolicySnapshot, policyHash, resolvePolicy } from '../../runtime-src/domain/workflow/policy.ts';

test('absent project policy selects documented defaults without creating state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-project-policy-'));
  const store = new ProjectPolicyStore(root);
  try {
    assert.deepEqual(await store.load(), { revision: 0, policy: DEFAULT_POLICY, source: 'documented-defaults' });
    assert.deepEqual(await readdir(root), []);
    await assert.rejects(store.select({}, 'selection', 0), /writer lease/);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await store.close();
    await closeHostStateWal(root); await rm(root, { recursive: true, force: true });
  }
});

test('explicit selection preserves immutable snapshots and does not activate an existing registration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-project-policy-'));
  const store = new ProjectPolicyStore(root);
  try {
    const generation = createPolicyGeneration('old-registration', (await store.load()).policy);
    await store.acquireWriter();
    const first = await store.select({ schema: { 'review.summary.maxLength': 480 } }, 'first', 0);
    assert.equal(first.current.revision, 1);
    assert.ok(Object.isFrozen(first.requestedPolicy.values.schema));
    assert.equal(first.current.policy.values.schema['review.summary.maxLength'], 480);
    assert.equal(generation.policy.values.schema['review.summary.maxLength'], 240);
    assert.throws(() => generation.assertCompatible(first.current.policy), /registration/);
    const second = await store.select({ schema: { 'review.summary.maxLength': 100 } }, 'second', 1);
    const retry = await store.select({ schema: { 'review.summary.maxLength': 480 } }, 'first', 0);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.requestedPolicy.digest, first.requestedPolicy.digest);
    assert.equal(retry.current.policy.digest, second.current.policy.digest);
    await assert.rejects(store.select({}, 'first', 0), /conflicting/);
    await assert.rejects(store.select({}, 'stale', 0), /stale/);
    await assert.rejects(store.select({ safety: { skipApproval: true } }, 'invalid', 2), /unknown/);
    const bytes = await readFile(join(root, '.tandem', 'living-canvas', 'policy', 'project-policy.json'), 'utf8');
    await store.close();
    const reopened = new ProjectPolicyStore(root);
    assert.equal((await reopened.load()).policy.digest, second.current.policy.digest);
    assert.equal(await readFile(join(root, '.tandem', 'living-canvas', 'policy', 'project-policy.json'), 'utf8'), bytes);
    const raw = await reopened.inspect() as { snapshots: Array<{ digest: string }> };
    assert.ok(raw.snapshots.some(({ digest }) => digest === first.requestedPolicy.digest));
  } finally {
    await store.close();
    await closeHostStateWal(root); await rm(root, { recursive: true, force: true });
  }
});

test('a future default edition cannot rewrite saved policy or completed selection requests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-project-policy-defaults-'));
  const first = new ProjectPolicyStore(root);
  let later: ProjectPolicyStore | undefined;
  try {
    await first.acquireWriter();
    const original = await first.select({}, 'original-default', 0);
    await first.close();
    const changed = resolvePolicy({ execution: { implementationAttempts: 3 }, schema: { 'review.summary.maxLength': 100 } });
    const body = {
      schemaVersion: changed.schemaVersion, semanticsVersion: changed.semanticsVersion,
      defaultsVersion: 'future-default-edition', values: changed.values,
    };
    const future = parsePolicySnapshot({ ...body, digest: policyHash(body) });
    later = new ProjectPolicyStore(root, { defaults: future });
    assert.equal((await later.load()).policy.digest, original.requestedPolicy.digest);
    await later.acquireWriter();
    const duplicate = await later.select({}, 'original-default', 0);
    assert.equal(duplicate.requestedPolicy.values.execution.implementationAttempts, 8);
    assert.equal(duplicate.current.policy.digest, original.requestedPolicy.digest);
    const selected = await later.select({}, 'new-work-default', 1);
    assert.equal(selected.current.policy.digest, future.digest);
    assert.equal(original.requestedPolicy.values.schema['review.summary.maxLength'], 240);
  } finally {
    await first.close();
    await later?.close();
    await closeHostStateWal(root); await rm(root, { recursive: true, force: true });
  }
});

for (const point of ['before-rename', 'after-rename'] as const) {
  test(`project selection is atomic and retryable at ${point}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'tandem-project-policy-atomic-'));
    let fail = true;
    const store = new ProjectPolicyStore(root, { boundary: (boundary) => {
      if (fail && boundary.point === point) {
        fail = false;
        throw new Error('injected selection boundary');
      }
    } });
    try {
      await store.acquireWriter();
      await assert.rejects(store.select({ execution: { implementationAttempts: 4 } }, 'select', 0), /injected/);
      const loaded = await store.load();
      assert.equal(loaded.revision, point === 'before-rename' ? 0 : 1);
      await store.close();
      await store.acquireWriter();
      const result = await store.select({ execution: { implementationAttempts: 4 } }, 'select', 0);
      assert.equal(result.current.revision, 1);
      assert.equal(result.current.policy.values.execution.implementationAttempts, 4);
      assert.equal((await store.select({ execution: { implementationAttempts: 4 } }, 'select', 0)).duplicate, true);
    } finally {
      await store.close();
      await closeHostStateWal(root); await rm(root, { recursive: true, force: true });
    }
  });
}

test('unknown or corrupt policy is inspectable but never replaced by defaults', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-project-policy-corrupt-'));
  const store = new ProjectPolicyStore(root);
  try {
    await store.acquireWriter();
    await store.select({}, 'select', 0);
    const path = join(root, '.tandem', 'living-canvas', 'policy', 'project-policy.json');
    const original = await readFile(path, 'utf8');
    const payload = decodeRecord(original) as { snapshots: Array<{ semanticsVersion: string }> };
    payload.snapshots[0]!.semanticsVersion = 'unknown-semantics';
    const unknown = encodeRecord(payload);
    await writeFile(path, unknown, 'utf8');
    await assert.rejects(store.load(), /unknown policy/);
    assert.deepEqual(await store.inspect(), payload);
    await assert.rejects(store.select({}, 'do-not-overwrite', 1), /unknown policy/);
    assert.equal(await readFile(path, 'utf8'), unknown);
    await assert.rejects(writeFile(path, '{bad json', 'utf8'), /JSON/);
    assert.equal(await readFile(path, 'utf8'), unknown, 'Invalid JSON cannot replace the retained WAL record.');
    const malformed = '{"malformed":"record"}';
    await writeFile(path, malformed, 'utf8');
    await assert.rejects(store.load(), /record|schema|checksum/i);
    assert.equal(await readFile(path, 'utf8'), malformed);
  } finally {
    await store.close();
    await closeHostStateWal(root); await rm(root, { recursive: true, force: true });
  }
});

test('lost selection acknowledgement replays the saved policy before consulting changed defaults', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-project-policy-retry-'));
  let loseAcknowledgement = true;
  const original = new ProjectPolicyStore(root, { boundary: ({ label, point }) => {
    if (loseAcknowledgement && label === 'select-project-policy' && point === 'after-rename') {
      loseAcknowledgement = false;
      throw new Error('lost selection acknowledgement');
    }
  } });
  let later: ProjectPolicyStore | undefined;
  try {
    await original.acquireWriter();
    const overrides = { schema: { 'useCases.minItems': 5 } };
    await assert.rejects(original.select(overrides, 'selection', 0), /lost selection acknowledgement/);
    const saved = await original.load();
    assert.equal(saved.revision, 1);
    assert.equal(saved.policy.values.schema['useCases.minItems'], 5);
    assert.equal(saved.policy.values.schema['useCases.maxItems'], 7);
    await original.close();

    const future = resolvePolicy({ schema: { 'useCases.minItems': 2, 'useCases.maxItems': 3 } });
    let laterWrites = 0;
    later = new ProjectPolicyStore(root, {
      defaults: future,
      boundary: ({ point }) => { if (point === 'before-rename') laterWrites += 1; },
    });
    await later.acquireWriter();
    const path = join(root, '.tandem', 'living-canvas', 'policy', 'project-policy.json');
    const bytes = await readFile(path, 'utf8');
    const history = await later.inspect();
    const duplicate = await later.select(overrides, 'selection', 0);
    assert.equal(duplicate.duplicate, true);
    assert.deepEqual(duplicate.requestedPolicy, saved.policy);
    assert.deepEqual(duplicate.current, saved);
    assert.ok(Object.isFrozen(duplicate.requestedPolicy.values.schema));
    await later.select(overrides, 'selection', 0);

    await assert.rejects(later.select({ schema: { 'useCases.minItems': 2 } }, 'selection', 0), /conflicting/);
    await assert.rejects(later.select({
      schema: { 'useCases.minItems': 5, 'useCases.maxItems': 7 },
    }, 'selection', 0), /conflicting/);
    await assert.rejects(later.select(overrides, 'selection', 1), /conflicting/);
    await assert.rejects(later.select({}, 'new-request', 0), /stale/);
    await assert.rejects(later.select(overrides, 'new-request', 1), /policy count range conflicts/);
    assert.equal(laterWrites, 0);
    assert.equal((await later.load()).revision, 1);
    assert.deepEqual(await later.inspect(), history);
    assert.equal(await readFile(path, 'utf8'), bytes);
  } finally {
    await original.close();
    await later?.close();
    await closeHostStateWal(root); await rm(root, { recursive: true, force: true });
  }
});

test('historical selection retries still validate raw override data rather than only its hash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-project-policy-raw-retry-'));
  const store = new ProjectPolicyStore(root);
  try {
    await store.acquireWriter();
    await store.select({}, 'empty-overrides', 0);
    const history = await store.inspect();
    await assert.rejects(store.select(new Date(), 'empty-overrides', 0), /plain data/);
    await assert.rejects(store.select({ execution: {} }, 'empty-overrides', 0), /conflicting/);
    await assert.rejects(store.select({ safety: { skipApproval: true } }, 'empty-overrides', 0), /unknown/);
    assert.deepEqual(await store.inspect(), history);
  } finally {
    await store.close();
    await closeHostStateWal(root); await rm(root, { recursive: true, force: true });
  }
});

test('queued selection hashes and resolves one private admission snapshot of caller overrides', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tandem-project-policy-admission-'));
  let reachedFirstWrite!: () => void;
  const firstWrite = new Promise<void>((resolve) => { reachedFirstWrite = resolve; });
  let releaseFirstWrite!: () => void;
  const release = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
  let writes = 0;
  const store = new ProjectPolicyStore(root, { boundary: async ({ label, point }) => {
    if (label === 'select-project-policy' && point === 'before-rename') {
      writes += 1;
      if (writes === 1) {
        reachedFirstWrite();
        await release;
      }
    }
  } });
  let first: ReturnType<ProjectPolicyStore['select']> | undefined;
  let pending: ReturnType<ProjectPolicyStore['select']> | undefined;
  try {
    await store.acquireWriter();
    first = store.select({}, 'first', 0);
    await firstWrite;
    const overrides = { schema: { 'useCases.minItems': 3 } };
    pending = store.select(overrides, 'second', 1);
    assert.equal(Object.isFrozen(overrides), false);
    assert.equal(Object.isFrozen(overrides.schema), false);
    overrides.schema['useCases.minItems'] = 6;
    releaseFirstWrite();
    await first;
    const selected = await pending;
    assert.equal(selected.requestedPolicy.values.schema['useCases.minItems'], 3);
    assert.equal(selected.current.revision, 2);
    assert.equal(overrides.schema['useCases.minItems'], 6);

    const path = join(root, '.tandem', 'living-canvas', 'policy', 'project-policy.json');
    const bytes = await readFile(path, 'utf8');
    const history = await store.inspect();
    const duplicate = await store.select({ schema: { 'useCases.minItems': 3 } }, 'second', 1);
    assert.equal(duplicate.duplicate, true);
    assert.deepEqual(duplicate.requestedPolicy, selected.requestedPolicy);
    await assert.rejects(store.select({ schema: { 'useCases.minItems': 6 } }, 'second', 1), /conflicting/);
    await assert.rejects(store.select({
      schema: { 'useCases.minItems': 3, 'useCases.maxItems': 7 },
    }, 'second', 1), /conflicting/);
    await assert.rejects(store.select({
      schema: { 'useCases.minItems': 3 }, execution: {},
    }, 'second', 1), /conflicting/);
    assert.equal(writes, 2);
    assert.deepEqual(await store.inspect(), history);
    assert.equal(await readFile(path, 'utf8'), bytes);
  } finally {
    releaseFirstWrite();
    await Promise.allSettled([...(first ? [first] : []), ...(pending ? [pending] : [])]);
    await store.close();
    await closeHostStateWal(root); await rm(root, { recursive: true, force: true });
  }
});
