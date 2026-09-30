import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { renderPermissionRequests } from '../public/permission-presentation.js';

function fixture() {
  const document = { activeElement: null };
  const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
  document.createElement = tagName => {
    let text = '';
    return {
      tagName, ownerDocument: document, children: [], parentElement: null, dataset: {},
      className: '', hidden: false, disabled: false, scrollTop: 0, attributes: {},
      get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); },
      get textContent() { return text + this.children.map(child => child.textContent).join(''); },
      set textContent(value) { this.replaceChildren(); text = String(value); },
      set innerHTML(_) { throw new Error('Permission content must stay literal text.'); },
      append(...nodes) {
        for (const node of nodes) {
          if (node.parentElement) node.parentElement.children = node.parentElement.children.filter(child => child !== node);
          node.parentElement = this; this.children.push(node);
        }
      },
      replaceChildren(...nodes) {
        for (const child of this.children) child.parentElement = null;
        this.children = []; text = ''; this.append(...nodes);
      },
      setAttribute(key, value) { this.attributes[key] = value; },
      contains(node) { return this === node || descendants(this).includes(node); },
      matches(selector) {
        if (selector.includes(' ')) {
          const [ancestor, child] = selector.split(' ');
          return this.matches(child) && Boolean(this.parentElement?.closest(ancestor));
        }
        if (selector === '[hidden]') return this.hidden;
        if (selector === '[data-access-decision]') return Boolean(this.dataset.accessDecision);
        return selector.startsWith('.') ? this.className.split(' ').includes(selector.slice(1)) : this.tagName === selector;
      },
      closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; },
      querySelectorAll(selector) { return descendants(this).filter(node => node.matches(selector)); },
      querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
      focus() { document.activeElement = this; },
    };
  };
  document.body = document.createElement('body');
  const container = document.createElement('section');
  document.body.append(container);
  const calls = [], errors = [];
  const actions = { decide: async (id, decision) => { calls.push({ id, decision }); },
    onError: error => errors.push(error.message) };
  const render = requests => renderPermissionRequests(container, requests, actions);
  return { document, container, calls, errors, actions, render,
    buttons: () => container.querySelectorAll('[data-access-decision]') };
}

function nativeRequest(toolName = 'apply_patch') {
  return {
    id: 'broker-request-1', kind: toolName === 'apply_patch' ? 'write' : 'read',
    title: toolName === 'apply_patch' ? 'Allow the agent to write this file?' : 'Allow the agent to read this path?',
    description: '  Exact native permission intention.\nNo inferred approval.  ',
    scopes: [toolName === 'apply_patch' ? 'filesystem write' : 'read-only', 'C:\\project\\src\\notes.txt'],
    canApproveForSession: false, canApproveAll: false, elevated: false, createdAt: '2026-09-21T03:39:00Z',
    nativeInvocation: { sessionId: 'native-session', toolCallId: 'native-call', toolName,
      taskId: 'selected-task', requestId: 'human-request' },
  };
}

test('native permissions without broad eligibility retain exact once/deny envelopes', async () => {
  for (const tool of ['view', 'glob', 'rg', 'apply_patch']) {
    for (const decision of ['once', 'denied']) {
      const ui = fixture(), request = nativeRequest(tool), retained = structuredClone(request);
      ui.render([request]);
      assert.deepEqual(ui.buttons().map(button => button.dataset.accessDecision), ['once', 'denied']);
      assert.match(ui.container.querySelector('.access-approval-scope').textContent, /Once approves only pending native requests/);
      assert.match(ui.container.textContent, /native per-tool grants remain unavailable/);
      assert.doesNotMatch(ui.container.querySelector('.access-approval-scope').textContent, /Session:|All:/);
      await ui.buttons().find(button => button.dataset.accessDecision === decision).onclick();
      assert.deepEqual(ui.calls, [{ id: request.id, decision }]);
      assert.ok(ui.buttons().every(button => button.disabled));
      ui.render([structuredClone(request)]);
      await ui.buttons()[0].onclick();
      assert.equal(ui.calls.length, 1);
      ui.render([]);
      assert.equal(ui.buttons().length, 0);
      assert.deepEqual(request, retained);
    }
  }
});

test('native path, diff/new contents, intention and all invocation identities remain exact literal details', () => {
  for (const payload of [
    'Diff:\n@@ -1 +1 @@\r\n-before\r\n+  <script>literal only</script>  \r\n',
    'New contents:\n  spaced content\n\n<script>not markup</script>\n',
  ]) {
    const ui = fixture(), request = nativeRequest();
    request.scopes.push(payload);
    request.elevated = true;
    ui.render([request]);
    const details = ui.container.querySelector('.access-request-details');
    const blocks = details.querySelectorAll('pre').map(node => node.textContent);
    assert.ok(blocks.includes(request.description));
    for (const scope of request.scopes) assert.ok(blocks.includes(scope));
    assert.deepEqual(JSON.parse(blocks.at(-1)), { brokerRequestId: request.id, nativeInvocation: request.nativeInvocation });
    const context = ui.container.querySelector('.access-request-context');
    const overview = context.children.filter(node => node.tagName === 'p').map(node => node.textContent);
    assert.ok(overview.includes(`Native tool: ${request.nativeInvocation.toolName}`));
    assert.ok(overview.includes(request.scopes[1]));
    assert.equal(overview.includes(payload), false, 'Large security payload belongs in verbatim details, not overview prose.');
    assert.match(context.textContent, /Elevated access requested/);
    assert.equal(details.open, undefined, 'Exact provenance remains in the existing collapsed disclosure.');
  }
});

test('native provenance forbids per-tool grants but supports explicitly eligible broker session access', async () => {
  const ui = fixture(), native = { ...nativeRequest(), canApproveForSession: true, canApproveAll: true };
  ui.render([native]);
  assert.deepEqual(ui.buttons().map(button => button.dataset.accessDecision), ['once', 'denied', 'all']);
  const custom = { ...nativeRequest(), id: 'custom', kind: 'custom-tool', title: 'Custom command',
    canApproveForSession: true, canApproveAll: true };
  delete custom.nativeInvocation;
  ui.render([custom]);
  assert.deepEqual(ui.buttons().map(button => button.dataset.accessDecision), ['once', 'denied', 'session', 'all']);
  await ui.buttons().find(button => button.dataset.accessDecision === 'session').onclick();
  assert.deepEqual(ui.calls, [{ id: 'custom', decision: 'session' }]);
});

test('native shell permissions preserve exact full command, paths and URLs with once-only approval', async () => {
  const ui = fixture(), request = nativeRequest('powershell');
  request.kind = 'shell';
  request.title = 'Allow the agent to run this shell command?';
  request.scopes = ['node app.mjs --name "two words"\r\n# exact command', 'C:\\project\\app.mjs', 'http://127.0.0.1:8123/'];
  ui.render([request]);
  const scopes = ui.container.querySelector('.access-request-details').querySelectorAll('pre').map(node => node.textContent);
  for (const value of request.scopes) assert.ok(scopes.includes(value));
  assert.deepEqual(ui.buttons().map(button => button.dataset.accessDecision), ['once', 'denied']);
  await ui.buttons()[0].onclick();
  assert.deepEqual(ui.calls, [{ id: request.id, decision: 'once' }]);
});

test('native snapshot/queue updates preserve inspected details, focus and scrolling; selection resets reading', async () => {
  const ui = fixture(), request = nativeRequest(), second = { ...nativeRequest('view'), id: 'broker-request-2' };
  ui.render([request]);
  const details = ui.container.querySelector('.access-request-details'), pane = ui.container.querySelector('.access-request-context');
  details.open = true; pane.scrollTop = 210;
  const button = ui.buttons()[0]; button.focus();
  ui.render([structuredClone(request), second]);
  assert.equal(ui.container.querySelector('.access-request-details'), details);
  assert.equal(details.open, true);
  assert.equal(pane.scrollTop, 210);
  assert.equal(ui.document.activeElement, button);
  const hiddenButton = ui.buttons().find(node => node.dataset.requestId === second.id);
  await hiddenButton.onclick();
  assert.deepEqual(ui.calls, []);
  const picker = ui.container.querySelector('.access-request-picker select');
  picker.value = second.id; picker.onchange();
  const card = ui.container.querySelectorAll('.access-card').find(node => !node.hidden);
  assert.equal(card.dataset.permissionId, second.id);
  assert.equal(card.querySelector('.access-request-context').scrollTop, 0);
  ui.render([]);
  await hiddenButton.onclick();
  assert.deepEqual(ui.calls, [], 'Withdrawn/disconnected requests cannot dispatch.');
});

test('failed native decisions re-enable only the current pending request and surface the exact error', async () => {
  const ui = fixture();
  ui.actions.decide = async () => { throw new Error('Native request was withdrawn.'); };
  ui.render([nativeRequest()]);
  await ui.buttons()[0].onclick();
  assert.deepEqual(ui.errors, ['Native request was withdrawn.']);
  assert.ok(ui.buttons().every(button => !button.disabled));
});

test('remembered broker state exposes Off separately from safe-idle custom per-tool reset', async () => {
  const source = await readFile(new URL('../public/human-loop-app.js', import.meta.url), 'utf8');
  const permissions = source.slice(source.indexOf('function renderPermissions()'), source.indexOf('async function refresh()'));
  assert.match(permissions, /Session access/);
  assert.match(permissions, /Separate custom per-tool approvals/);
  assert.match(permissions, /does not reset native CLI grants/);
  assert.match(permissions, /Reset custom approvals/);
  assert.match(permissions, /post\('\/api\/permissions\/reset', \{\}\)/);
  assert.match(permissions, /post\('\/api\/permissions\/off', \{\}\)/);
  assert.match(permissions, /Native permission mode stays manual/);
  assert.match(permissions, /reset\.disabled = !snapshot\.workflow\?\.canResetApprovals/);
  assert.match(permissions, /post\(`\/api\/access\/\$\{encodeURIComponent\(id\)\}`, \{ decision \}\)/);
});
