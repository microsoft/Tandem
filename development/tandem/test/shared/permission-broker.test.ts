import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getEventListeners } from 'node:events';
import type { PermissionRequest } from '@github/copilot-sdk';
import { InMemoryEventStore } from '../../runtime-src/event-store.js';
import { PermissionBroker } from '../../runtime-src/permissions/permission-broker.js';

function writeRequest(): PermissionRequest {
  return {
    kind: 'write',
    canOfferSessionApproval: true,
    diff: '--- /dev/null\n+++ server.js',
    fileName: 'server.js',
    intention: 'Create the task API server.',
  };
}

test('command approvals expose exact scope and broad provenance; reset isolates future prompts', async () => {
  const events = new InMemoryEventStore(), broker = new PermissionBroker(events);
  const request: PermissionRequest = { kind: 'custom-tool', toolName: 'run_workflow_command',
    toolDescription: 'Check the existing application. Project working copy: fixture',
    args: { command: 'node', args: ['--check', 'app.mjs'], cwd: 'app' } };
  const first = broker.request(request, { sessionId: 'private' });
  const pending = broker.list()[0]!;
  assert.equal(pending.title, 'Run node?');
  assert.ok(pending.scopes.includes('Arguments: ["--check","app.mjs"]'));
  await broker.decide(pending.id, 'all'); await first;
  await broker.request(request, { sessionId: 'private' });
  const grant = events.list().at(-1)?.data;
  assert.ok(grant && typeof grant === 'object' && 'grantRequestId' in grant);
  assert.equal(grant.grantRequestId, pending.id);
  const other = broker.request(request, { sessionId: 'other' });
  await broker.decide(broker.list()[0]!.id, 'session'); await other;
  assert.deepEqual(broker.remembered('other'), { all: false, tools: ['run_workflow_command'] });
  broker.resetSession('private');
  assert.deepEqual(broker.remembered('private'), { all: false, tools: [] });
  assert.deepEqual(broker.remembered('other'), { all: false, tools: ['run_workflow_command'] });
  const again = broker.request(request, { sessionId: 'private' });
  assert.equal(broker.list().length, 1);
  await broker.decide(broker.list()[0]!.id, 'session'); await again;
  broker.resetSession('private');
  assert.deepEqual(broker.remembered('private'), { all: false, tools: [] });
  const afterToolReset = broker.request(request, { sessionId: 'private' });
  assert.equal(broker.list().length, 1);
  await broker.decide(broker.list()[0]!.id, 'denied'); await afterToolReset;
});

test('holds a permission request until the user allows it once', async () => {
  const events = new InMemoryEventStore();
  const broker = new PermissionBroker(events);
  const result = broker.request(writeRequest());
  const pending = broker.list()[0];

  assert.equal(pending?.title, 'Allow the agent to write this file?');
  assert.deepEqual(pending?.scopes, ['filesystem write', 'server.js', 'Diff:\n--- /dev/null\n+++ server.js']);
  assert.equal(pending?.canApproveForSession, true);
  assert.equal(pending?.canApproveAll, true);

  await broker.decide(pending?.id ?? '', 'once');

  assert.deepEqual(await result, { kind: 'approve-once', approvedInteractively: true });
  assert.deepEqual(broker.list(), []);
  assert.deepEqual(events.list().map(({ type }) => type), [
    'permission.requested',
    'permission.granted',
  ]);
});

test('translates session approval into the SDK write scope', async () => {
  const broker = new PermissionBroker(new InMemoryEventStore());
  const result = broker.request(writeRequest());
  const requestId = broker.list()[0]?.id ?? '';

  await broker.decide(requestId, 'session');

  assert.deepEqual(await result, {
    kind: 'approve-for-session',
    approval: { kind: 'write' },
  });
});

test('does not offer unsupported session approval', async () => {
  const broker = new PermissionBroker(new InMemoryEventStore());
  const result = broker.request({
    kind: 'url',
    intention: 'Read API documentation.',
    url: 'https://example.com/docs',
  });
  const pending = broker.list()[0];

  assert.equal(pending?.canApproveForSession, false);
  await assert.rejects(
    broker.decide(pending?.id ?? '', 'session'),
    /cannot be approved for the session/,
  );
  await broker.decide(pending?.id ?? '', 'denied');
  assert.equal((await result).kind, 'reject');
});

test('allows all queued and future access for the session', async () => {
  const broker = new PermissionBroker(new InMemoryEventStore());
  const first = broker.request(writeRequest());
  const second = broker.request({
    kind: 'read',
    path: 'package.json',
    intention: 'Inspect package metadata.',
  });
  const requestId = broker.list()[0]?.id ?? '';

  await broker.decide(requestId, 'all');

  assert.equal((await first).kind, 'approve-once');
  assert.equal((await second).kind, 'approve-once');
  assert.deepEqual(broker.list(), []);

  const future = await broker.request({
    kind: 'url',
    intention: 'Read API documentation.',
    url: 'https://example.com/docs',
  });
  assert.deepEqual(future, { kind: 'approve-once' });
  assert.deepEqual(broker.list(), []);
});

test('does not offer allow-all when managed settings are enabled', async () => {
  const broker = new PermissionBroker(new InMemoryEventStore());
  const result = broker.request(writeRequest(), {
    sessionId: 'managed-session',
    managedSettingsEnabled: true,
  });
  const pending = broker.list()[0];

  assert.equal(pending?.canApproveAll, false);
  await assert.rejects(
    broker.decide(pending?.id ?? '', 'all'),
    /Managed policy prevents approving all access/,
  );
  await broker.decide(pending?.id ?? '', 'denied');
  assert.equal((await result).kind, 'reject');
});

test('already cancelled task never enqueues a permission or an approval promise', async () => {
  const events = new InMemoryEventStore(), broker = new PermissionBroker(events);
  const lifetime = new AbortController();
  lifetime.abort();
  const result = await broker.request(writeRequest(), { sessionId: 'private' }, lifetime.signal);
  assert.equal(result.kind, 'reject');
  assert.match('feedback' in result ? result.feedback ?? '' : '', /withdrawn/);
  assert.deepEqual(broker.list(), []);
  assert.deepEqual(events.list(), []);
  assert.equal(getEventListeners(lifetime.signal, 'abort').length, 0);
});

test('task cancellation withdraws only its pending permissions and settles promises without user denial', async () => {
  const events = new InMemoryEventStore(), broker = new PermissionBroker(events);
  const lifetime = new AbortController(), otherLifetime = new AbortController();
  const stopped = broker.request(writeRequest(), { sessionId: 'private' }, lifetime.signal);
  const stoppedId = broker.list()[0]!.id;
  const alsoStopped = broker.request(writeRequest(), { sessionId: 'private' }, lifetime.signal);
  const other = broker.request(writeRequest(), { sessionId: 'other' }, otherLifetime.signal);
  const otherId = broker.list().at(-1)!.id;
  lifetime.abort();
  assert.equal((await stopped).kind, 'reject');
  assert.equal((await alsoStopped).kind, 'reject');
  assert.deepEqual(broker.list().map(({ id }) => id), [otherId]);
  assert.equal(getEventListeners(lifetime.signal, 'abort').length, 0);
  assert.equal(events.list().filter(({ type }) => type === 'permission.cancelled').length, 2);
  assert.equal(events.list().some(({ type }) => type === 'permission.denied' || type === 'permission.granted'), false);
  await assert.rejects(broker.decide(stoppedId, 'once'), /not pending/);
  await broker.decide(otherId, 'once');
  assert.equal((await other).kind, 'approve-once');
});

for (const decision of ['once', 'denied'] as const) test(`cancellation after ${decision} neither changes its result nor removes the next task request`, async () => {
  const events = new InMemoryEventStore(), broker = new PermissionBroker(events);
  const lifetime = new AbortController();
  const first = broker.request(writeRequest(), { sessionId: 'private' }, lifetime.signal);
  await broker.decide(broker.list()[0]!.id, decision);
  assert.equal((await first).kind, decision === 'once' ? 'approve-once' : 'reject');
  assert.equal(getEventListeners(lifetime.signal, 'abort').length, 0);
  const nextLifetime = new AbortController();
  const next = broker.request(writeRequest(), { sessionId: 'private' }, nextLifetime.signal);
  const nextId = broker.list()[0]!.id;
  lifetime.abort();
  assert.deepEqual(broker.list().map(({ id }) => id), [nextId]);
  assert.equal(events.list().some(({ type }) => type === 'permission.cancelled'), false);
  nextLifetime.abort();
  assert.equal((await next).kind, 'reject');
});

test('cancellation during async allow-all cannot grant its withdrawn request or strand other requests', async () => {
  const events = new InMemoryEventStore(), broker = new PermissionBroker(events);
  const lifetime = new AbortController();
  const stopped = broker.request(writeRequest(), { sessionId: 'private' }, lifetime.signal);
  const stoppedId = broker.list()[0]!.id;
  const other = broker.request(writeRequest(), { sessionId: 'private' });
  const all = broker.decide(stoppedId, 'all');
  lifetime.abort();
  await all;
  assert.equal((await stopped).kind, 'reject');
  assert.equal((await other).kind, 'approve-once');
  assert.equal(events.list().some(({ type, data }) => type === 'permission.granted'
    && (data as { requestId?: string }).requestId === stoppedId), false);
  assert.deepEqual(broker.list(), []);
});

test('clean-session renewal withdraws only that session and revokes its allow-all cache', async () => {
  const broker = new PermissionBroker(new InMemoryEventStore());
  const first = broker.request(writeRequest(), { sessionId: 'private' });
  const unrelated = broker.request(writeRequest(), { sessionId: 'other' });
  await broker.decide(broker.list()[0]!.id, 'all');
  assert.equal((await first).kind, 'approve-once');
  const unrelatedId = broker.list()[0]!.id;
  broker.resetSession('private');
  assert.deepEqual(broker.list().map(({ id }) => id), [unrelatedId]);
  const renewed = broker.request(writeRequest(), { sessionId: 'private' });
  const renewedId = broker.list()[1]!.id;
  broker.resetSession('private');
  assert.equal((await renewed).kind, 'reject');
  await assert.rejects(broker.decide(renewedId, 'once'), /not pending/);
  await broker.decide(unrelatedId, 'once');
  assert.equal((await unrelated).kind, 'approve-once');
});

test('clean-session renewal racing automatic approval cannot return an old grant', async () => {
  const broker = new PermissionBroker(new InMemoryEventStore());
  const first = broker.request(writeRequest(), { sessionId: 'private' });
  await broker.decide(broker.list()[0]!.id, 'all');
  await first;
  const pending = broker.request(writeRequest(), { sessionId: 'private' });
  broker.resetSession('private');
  assert.equal((await pending).kind, 'reject');
  assert.deepEqual(broker.list(), []);
});

test('an in-flight allow-all decision cannot cross renewal and grant a newly queued request', async () => {
  const broker = new PermissionBroker(new InMemoryEventStore());
  const previous = broker.request(writeRequest(), { sessionId: 'private' });
  const granting = broker.decide(broker.list()[0]!.id, 'all');
  broker.resetSession('private');
  const next = broker.request(writeRequest(), { sessionId: 'private' });
  const nextId = broker.list()[0]!.id;
  await granting;
  assert.equal((await previous).kind, 'reject');
  assert.deepEqual(broker.list().map(({ id }) => id), [nextId]);
  await broker.decide(nextId, 'denied');
  assert.equal((await next).kind, 'reject');
});

test('native session access reuses the broker grant but never offers native per-tool approvals', async () => {
  const events = new InMemoryEventStore(), broker = new PermissionBroker(events);
  const options = { onceOnly: true, nativeSessionGrantEligible: true,
    provenance: { toolName: 'view', taskId: 'task', requestId: 'request', role: 'designer' } };
  const request: PermissionRequest = { kind: 'read', path: 'project.txt', intention: 'Read', toolCallId: 'call' };
  const first = broker.request(request, { sessionId: 'private' }, undefined, options);
  const pending = broker.list('private')[0]!;
  assert.equal(pending.canApproveForSession, false);
  assert.equal(pending.canApproveAll, true);
  assert.deepEqual(pending.nativeInvocation, { sessionId: 'private', toolCallId: 'call', ...options.provenance });
  await assert.rejects(broker.decide(pending.id, 'session'), /cannot be approved/);
  await broker.decide(pending.id, 'all', 'private');
  assert.equal((await first).kind, 'approve-once');
  assert.equal((await broker.request(request, { sessionId: 'private' }, undefined, options)).kind, 'approve-once');
  const automatic = events.listRecent(1)[0]!;
  assert.equal(automatic.source, 'system');
  assert.ok(automatic.data && typeof automatic.data === 'object' && 'permissionKind' in automatic.data && 'activity' in automatic.data);
  assert.equal(automatic.data.permissionKind, 'read');
  assert.deepEqual(automatic.data.activity, { sessionId: 'private', toolCallId: 'call', ...options.provenance });
  assert.equal((await broker.request({ ...request, toolCallId: 'descendant-call' }, { sessionId: 'private' }, undefined,
    { onceOnly: true, nativeSessionGrantEligible: true })).kind, 'approve-once');
  const descendant = events.listRecent(1)[0]!;
  assert.ok(descendant.data && typeof descendant.data === 'object' && !('activity' in descendant.data),
    'A native descendant grant must not invent a root request/role attribution.');
  assert.deepEqual(broker.remembered('private').tools, []);
  const other = broker.request(request, { sessionId: 'other' }, undefined, options);
  const managed = broker.request(request, { sessionId: 'private', managedSettingsEnabled: true }, undefined, options);
  assert.equal(broker.list('private')[0]!.canApproveAll, false);
  await assert.rejects(broker.decide(broker.list('private')[0]!.id, 'all'), /Managed policy/);
  const before = broker.list().map(({ id }) => id);
  broker.revokeAll('private');
  assert.deepEqual(broker.list().map(({ id }) => id), before, 'Off must not withdraw pending requests.');
  assert.equal(broker.remembered('private').all, false);
  const next = broker.request(request, { sessionId: 'private' }, undefined, options);
  assert.equal(broker.list('private').length, 2);
  for (const entry of broker.list()) await broker.decide(entry.id, 'once');
  assert.deepEqual((await Promise.all([other, managed, next])).map(r => r.kind), ['approve-once', 'approve-once', 'approve-once']);
});

test('captured once sets exclude late arrivals, reject foreign sessions before changes, and report withdrawals', async () => {
  const events = new InMemoryEventStore(), broker = new PermissionBroker(events), controller = new AbortController();
  const a = broker.request(writeRequest(), { sessionId: 'private' });
  const b = broker.request(writeRequest(), { sessionId: 'private' }, controller.signal);
  const other = broker.request(writeRequest(), { sessionId: 'other' });
  const captured = broker.list('private').map(({ id }) => id), foreign = broker.list('other')[0]!.id;
  await assert.rejects(broker.approvePendingOnce('private', [captured[0]!, foreign]), /different session/);
  assert.equal(broker.list().length, 3);
  let late: Promise<unknown> | undefined;
  const unsubscribe = events.subscribe(event => {
    if (event.type === 'permission.granted') {
      unsubscribe(); controller.abort(); late = broker.request(writeRequest(), { sessionId: 'private' });
    }
  });
  assert.deepEqual(await broker.approvePendingOnce('private', captured), [
    { requestId: captured[0], status: 'approved' }, { requestId: captured[1], status: 'not-pending' },
  ]);
  assert.equal((await a).kind, 'approve-once'); assert.equal((await b).kind, 'reject');
  assert.equal(broker.list('private').length, 1, 'Late arrival is not part of the captured set.');
  assert.deepEqual(await broker.approvePendingOnce('private', captured), captured.map(requestId => ({ requestId, status: 'not-pending' })));
  for (const entry of broker.list()) await broker.decide(entry.id, 'denied');
  await Promise.all([other, late]);
});

test('Off racing automatic and pending all approvals prompts again instead of denying live requests', async () => {
  const broker = new PermissionBroker(new InMemoryEventStore());
  const first = broker.request(writeRequest(), { sessionId: 'private' });
  const all = broker.decide(broker.list()[0]!.id, 'all');
  broker.revokeAll('private');
  await all;
  assert.equal(broker.list().length, 1);
  await broker.decide(broker.list()[0]!.id, 'all'); await first;
  const automatic = broker.request(writeRequest(), { sessionId: 'private' });
  broker.revokeAll('private');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(broker.list().length, 1);
  await broker.decide(broker.list()[0]!.id, 'once');
  assert.equal((await automatic).kind, 'approve-once');
  assert.equal(broker.remembered('private').all, false);
});
