import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { renderBackgroundProcesses } from '../public/background-processes.js';

function fixture() {
  const document = { listeners: {}, activeElement: null,
    addEventListener(name, callback) { this.listeners[name] = callback; } };
  const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
  document.createElement = tagName => {
    let text = '';
    return {
      tagName, ownerDocument: document, children: [], parentElement: null, dataset: {}, attributes: {}, listeners: {},
      hidden: false, disabled: false, open: false,
      get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); },
      get textContent() { return text + this.children.map(child => child.textContent).join(''); },
      set textContent(value) { text = String(value); this.children = []; },
      set innerHTML(_) { throw new Error('Native values must remain text.'); },
      append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } },
      remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, callback) { this.listeners[name] = callback; },
      contains(node) { return this === node || descendants(this).includes(node); },
      focus() { document.activeElement = this; },
    };
  };
  document.body = document.createElement('body');
  const container = document.createElement('span');
  document.body.append(container);
  const calls = [], errors = [], actions = {
    connected: true, stop: async id => { calls.push(id); }, onError: error => errors.push(error.message),
  };
  const render = sessions => renderBackgroundProcesses(container, sessions, actions);
  const all = tag => descendants(container).filter(node => node.tagName === tag);
  const disclosure = () => all('details')[0];
  return { document, container, calls, errors, actions, render, all, disclosure };
}

function session(id = 'opaque-native-journal-id', overrides = {}) {
  return { id, sessionId: 'native-session', shellId: `owned-${id}`, command: 'node server.mjs', mode: 'async',
    backgroundOrigin: 'explicit-async',
    status: 'running', exitCode: null, taskId: 'task', requestId: 'request', cycleId: null,
    toolCallId: 'call', startedAt: '2026-09-21T04:00:00Z', endedAt: null, reason: null, canStop: true, ...overrides };
}

test('compact disclosure counts unfinished/unverified backgrounds, not model activity or completed history', () => {
  const ui = fixture();
  ui.render([]);
  assert.equal(ui.container.hidden, true);
  const entries = ['starting', 'running', 'held', 'completed', 'failed', 'stopped', 'unexpected'].map(status =>
    session(status, { status, canStop: status !== 'held' }));
  const original = structuredClone(entries);
  ui.render(entries);
  assert.equal(ui.disclosure().open, false);
  assert.equal(ui.all('summary')[0].textContent, 'Background 4');
  assert.match(ui.all('summary')[0].title, /unfinished or unverified/);
  assert.match(ui.container.textContent, /Workflow|workflow/);
  assert.match(ui.container.textContent, /Unconfirmed/);
  assert.match(ui.container.textContent, /Unknown/);
  assert.ok(ui.all('button').every(button => !button.hidden));
  assert.deepEqual(ui.all('button').filter(button => !button.disabled).map(button => button.dataset.nativeProcessId),
    ['starting', 'running']);
  ui.render(entries.filter(entry => ['completed', 'failed', 'stopped'].includes(entry.status)));
  assert.equal(ui.all('summary')[0].textContent, 'Background 0');
  assert.equal(ui.container.hidden, false, 'Confirmed stopped/failed/completed outcomes remain inspectable.');
  assert.deepEqual(entries, original);
});

test('background provenance excludes foreground sync and retains rollover history and lost ownership', () => {
  const ui = fixture();
  const foreground = session('foreground', { mode: 'sync', backgroundOrigin: null, status: 'starting' });
  const unverifiedSync = session('unverified', { mode: 'sync', backgroundOrigin: undefined, status: 'held' });
  ui.render([foreground, unverifiedSync]);
  assert.equal(ui.container.hidden, true);
  const rollover = session('rollover', { mode: 'sync', backgroundOrigin: 'sync-rollover' });
  ui.render([foreground, unverifiedSync, rollover, session('async')]);
  assert.equal(ui.all('summary')[0].textContent, 'Background 2');
  assert.equal(ui.all('li').length, 2);
  ui.render([foreground, { ...rollover, status: 'held', canStop: false }]);
  assert.equal(ui.all('summary')[0].textContent, 'Background 1');
  assert.match(ui.container.textContent, /Unconfirmed/);
  ui.render([{ ...rollover, status: 'completed', canStop: false }]);
  assert.equal(ui.all('summary')[0].textContent, 'Background 0');
  assert.equal(ui.all('li').length, 1);
});

test('retired control remains Unconfirmed history at Background 0 with a disabled Stop', () => {
  const ui = fixture();
  ui.render([session('retired', { status: 'held', canStop: true, recordedStatus: 'running',
    controlRetirement: { outcome: 'authority-retired-process-state-unconfirmed' },
    reason: 'Historical control authority retired; process state remains unconfirmed.' })]);
  assert.equal(ui.all('summary')[0].textContent, 'Background 0');
  assert.equal(ui.container.hidden, false);
  assert.match(ui.container.textContent, /Unconfirmed/);
  assert.match(ui.container.textContent, /recordedStatus/);
  assert.equal(ui.all('button')[0].hidden, false);
  assert.equal(ui.all('button')[0].disabled, true);
});

test('unattributed current catalog rows expose exact Stop while historical reused labels stay disabled', async () => {
  const ui = fixture();
  const old = session('historical', { status: 'held', recordedStatus: 'running', canStop: false, shellId: 'reused' });
  const current = session('native-task:reused:new-start', { backgroundOrigin: 'native-task',
    shellId: 'reused', taskId: null, requestId: null, cycleId: null, toolCallId: null });
  ui.render([old, current]); ui.disclosure().open = true;
  assert.equal(ui.all('li').length, 2);
  assert.equal(ui.all('button')[0].disabled, true);
  assert.equal(ui.all('button')[1].disabled, false);
  await ui.all('button')[0].onclick();
  await ui.all('button')[1].onclick();
  assert.deepEqual(ui.calls, [current.id]);
  ui.render([old, { ...current, status: 'stopped', canStop: false }]);
  assert.equal(ui.all('button')[1].disabled, true);
});

test('per-process Stop uses exact identity and per-row pending feedback without blocking another process', async () => {
  const ui = fixture(), entries = [session(), session('second')];
  const finishes = new Map();
  ui.actions.stop = id => { ui.calls.push(id); return new Promise(resolve => { finishes.set(id, resolve); }); };
  ui.render(entries); ui.disclosure().open = true;
  const button = ui.all('button')[0];
  const work = button.onclick();
  assert.deepEqual(ui.calls, [entries[0].id]);
  assert.equal(button.disabled, true);
  assert.equal(ui.all('button')[1].disabled, false);
  await button.onclick();
  assert.equal(ui.calls.length, 1);
  const secondWork = ui.all('button')[1].onclick();
  assert.deepEqual(ui.calls, entries.map(entry => entry.id));
  ui.render(structuredClone(entries));
  assert.match(ui.all('li')[0].textContent, /Running/);
  finishes.get(entries[0].id)(); finishes.get(entries[1].id)(); await Promise.all([work, secondWork]);
  assert.match(ui.all('li')[0].textContent, /Running/, 'HTTP/callback completion alone is not an exit observation.');
  ui.render([{ ...entries[0], status: 'stopped', canStop: false, endedAt: '2026-09-21T04:01:00Z' }, entries[1]]);
  assert.match(ui.all('li')[0].textContent, /Stopped/);
  assert.equal(ui.all('button')[0].hidden, false);
  assert.equal(ui.all('button')[0].disabled, true);
  assert.equal(ui.all('summary')[0].textContent, 'Background 1');
});

test('unconfirmed Stop surfaces exact error; held rows remain truthful and only retry with current authority', async () => {
  const ui = fixture();
  ui.actions.stop = async () => { throw new Error('Native runtime did not confirm process stop.'); };
  ui.render([session()]); ui.disclosure().open = true;
  await ui.all('button')[0].onclick();
  assert.match(ui.container.textContent, /Stop not confirmed: Native runtime did not confirm process stop/);
  assert.deepEqual(ui.errors, ['Native runtime did not confirm process stop.']);
  ui.render([session(undefined, { status: 'held', reason: 'Historical ownership unverified.', canStop: false })]);
  assert.match(ui.container.textContent, /Unconfirmed/);
  assert.match(ui.container.textContent, /Historical ownership unverified/);
  assert.equal(ui.all('button')[0].hidden, false);
  assert.equal(ui.all('button')[0].disabled, true);
});

test('pending Stop preserves Escape access before disabling the focused control', async () => {
  const ui = fixture();
  let finish;
  ui.actions.stop = () => new Promise(resolve => { finish = resolve; });
  ui.render([session()]); ui.disclosure().open = true;
  const button = ui.all('button')[0];
  button.focus();
  const work = button.onclick();
  assert.equal(button.disabled, true);
  assert.equal(ui.document.activeElement, ui.all('summary')[0]);
  ui.disclosure().listeners.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(ui.disclosure().open, false);
  ui.render([session(undefined, { status: 'stopped', canStop: false })]);
  finish(); await work;
  assert.equal(ui.document.activeElement, ui.all('summary')[0]);
  assert.equal(ui.disclosure().open, false);
});

test('withdrawn Stop preserves disclosure focus without stealing focus from other controls', () => {
  for (const change of [{ status: 'completed', canStop: false }, { status: 'held', canStop: false }]) {
    const ui = fixture();
    ui.render([session()]); ui.disclosure().open = true;
    ui.all('button')[0].focus();
    ui.render([session(undefined, change)]);
    assert.equal(ui.all('button')[0].hidden, false);
    assert.equal(ui.all('button')[0].disabled, true);
    assert.equal(ui.document.activeElement, ui.all('summary')[0]);
    const composer = ui.document.createElement('textarea');
    ui.document.body.append(composer); composer.focus();
    ui.render([session(undefined, change)]);
    assert.equal(ui.document.activeElement, composer);
  }
});

test('closed, disconnected and withdrawn controls cannot dispatch; updates preserve disclosure and keyboard focus', async () => {
  const ui = fixture();
  ui.render([session()]);
  const button = ui.all('button')[0];
  await button.onclick();
  assert.deepEqual(ui.calls, []);
  ui.disclosure().open = true; button.focus();
  ui.render([session()]);
  assert.equal(ui.disclosure().open, true);
  assert.equal(ui.document.activeElement, button);
  let prevented = false;
  ui.disclosure().listeners.keydown({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, true);
  assert.equal(ui.disclosure().open, false);
  assert.equal(ui.document.activeElement, ui.all('summary')[0]);
  assert.equal(button.type, 'button', 'Stop cannot submit the enclosing composer form.');
  ui.disclosure().open = true;
  ui.actions.connected = false; ui.render([session()]);
  await button.onclick();
  ui.render([]); await button.onclick();
  assert.deepEqual(ui.calls, []);
});

test('full command and provenance remain literal; native rows never invent app URLs or PIDs', () => {
  const ui = fixture(), entry = session(undefined, { command: '  node app.mjs\n<script>not HTML</script>  ' });
  ui.render([entry]);
  assert.ok(ui.all('pre').some(node => node.textContent === entry.command));
  const provenance = JSON.parse(ui.all('pre').at(-1).textContent);
  for (const key of ['id', 'sessionId', 'shellId', 'mode', 'taskId', 'requestId', 'cycleId', 'toolCallId', 'exitCode']) {
    assert.equal(provenance[key], entry[key]);
  }
  assert.equal(ui.all('a').length, 0);
  assert.equal('url' in provenance, false); assert.equal('pid' in provenance, false);
  ui.disclosure().open = true;
  ui.document.listeners.pointerdown({ target: ui.all('li')[0] });
  assert.equal(ui.disclosure().open, true);
  ui.document.listeners.pointerdown({ target: ui.document.body });
  assert.equal(ui.disclosure().open, false);
});

test('compact composer wiring uses native DTO and existing opaque-id endpoint; narrow/theme sizing is bounded', async () => {
  const app = await readFile(new URL('../public/human-loop-app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/human-loop.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/human-loop-shell.css', import.meta.url), 'utf8');
  assert.match(app, /snapshot\?\.processes\?\.nativeSessions/);
  assert.match(app, /post\('\/api\/apps\/stop', \{ id \}\)/);
  assert.match(html, /<div class="composer-actions">[\s\S]*?<span id="background-processes" hidden><\/span>/);
  assert.match(css, /\.background-panel\s*\{[^}]*width: min\(420px, 100%\)/s);
  assert.match(css, /\.background-panel\s*\{[^}]*max-height: min\(380px, 60dvh\)/s);
  assert.match(css, /\.background-panel\s*\{[^}]*background: var\(--surface\)/s);
  assert.match(css, /\.background-disclosure > summary \{ border-radius: 999px; \}/);
  assert.match(css, /:is\(button, select, textarea, input, summary\):focus-visible/);
});
