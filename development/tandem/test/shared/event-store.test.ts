import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { InMemoryEventStore, SqliteEventStore } from '../../runtime-src/event-store.js';

test('assigns ordered sequences and supports cursor reads', () => {
  const store = new InMemoryEventStore();
  const first = store.append({ type: 'test.first', source: 'system', summary: 'First' });
  const second = store.append({ type: 'test.second', source: 'system', summary: 'Second' });

  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.deepEqual(store.list(1), [second]);
  assert.deepEqual(store.listRecent(1), [second]);
  assert.deepEqual(store.listRecent(10), [first, second]);
  for (const limit of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => store.listRecent(limit), /positive integer/);
  }
  assert.match(first.timestamp, /^\d{4}-\d{2}-\d{2}T/);
});

test('append-only SQLite history supports bounded chronological reads after restart', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tandem-append-only-history-'));
  try {
    const first = new SqliteEventStore(workspace, null);
    try {
      for (let sequence = 1; sequence <= 1_000; sequence += 1) {
        first.append({
          type: 'request.received',
          source: 'user',
          summary: `Request ${sequence}`,
          data: { sessionEventId: `session-event-${sequence}` },
        });
      }
    } finally {
      first.close();
    }
    const restored = new SqliteEventStore(workspace, null);
    try {
      assert.equal(restored.list().length, 1_000);
      assert.deepEqual(restored.listRecent(3).map(({ sequence }) => sequence), [998, 999, 1_000]);
      assert.equal(restored.listRecent(500).length, 500);
      assert.equal(restored.listRecent(2_000).length, 1_000);
      assert.equal(restored.hasSessionEventId('session-event-1'), true);
      for (const limit of [0, -1, 1.5, NaN, Infinity]) {
        assert.throws(() => restored.listRecent(limit), /positive integer/);
      }
      restored.append({ type: 'assistant.message_delta', source: 'copilot', summary: 'Partial' });
      const latest = restored.append({ type: 'assistant.message', source: 'copilot', summary: 'Complete' });
      assert.equal(latest.sequence, 1_002);
      assert.deepEqual(restored.listRecent(2).map(({ sequence }) => sequence), [1_000, 1_002]);
      assert.deepEqual(restored.list(1_000), [latest]);
    } finally {
      restored.close();
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('notifies subscribers until they unsubscribe', () => {
  const store = new InMemoryEventStore();
  const observed: number[] = [];
  const unsubscribe = store.subscribe((event) => observed.push(event.sequence));

  store.append({ type: 'test.first', source: 'system', summary: 'First' });
  unsubscribe();
  store.append({ type: 'test.second', source: 'system', summary: 'Second' });

  assert.deepEqual(observed, [1]);
});

test('restores complete Activity events and stream identity from SQLite', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'tandem-event-history-'));
  try {
    const first = new SqliteEventStore(workspace);
    const streamId = first.streamId;
    const request = first.append({
      type: 'request.received',
      source: 'user',
      summary: 'Implement task capture.',
      data: { requestId: 'request-1' },
    });
    const delta = first.append({
      type: 'assistant.message_delta',
      source: 'copilot',
      summary: 'partial',
    });
    const response = first.append({
      type: 'assistant.message',
      source: 'copilot',
      summary: 'Task capture is implemented.',
    });
    first.rememberSessionEventId('hidden-review-message');
    first.close();

    const restarted = new SqliteEventStore(workspace);
    assert.equal(restarted.streamId, streamId);
    assert.equal(restarted.hasSessionEventId('hidden-review-message'), true);
    assert.deepEqual(restarted.list(), [request, response]);
    assert.equal(restarted.list(request.sequence)[0]?.sequence, response.sequence);
    assert.equal(
      restarted.append({
        type: 'session.idle',
        source: 'copilot',
        summary: 'Ready',
      }).sequence,
      delta.sequence + 2,
    );
    restarted.close();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
