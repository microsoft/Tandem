import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkflowStopControl } from '../public/workflow-stop-control.js';

function fixture() {
  const document = { listeners: {}, addEventListener(name, callback) { this.listeners[name] = callback; } };
  const element = () => ({ hidden: false, disabled: false, attributes: {}, listeners: {}, ownerDocument: document,
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    scrollIntoView() {},
    focus() { document.activeElement = this; } });
  const elements = Object.fromEntries(['container', 'primary', 'toggle', 'menu', 'immediate'].map(name => [name, element()]));
  elements.container.contains = target => Object.values(elements).includes(target);
  elements.menu.hidden = true;
  const calls = [], errors = [];
  let request = async mode => { calls.push(mode); };
  const control = createWorkflowStopControl(elements, mode => request(mode), error => errors.push(error.message));
  const render = (view = { canStop: true, canStopNow: true }, options = {}) =>
    control.render(view, { connected: true, pending: false, ...options });
  return { ...elements, document, render, calls, errors, setRequest: value => { request = value; } };
}

test('graceful is always primary, while pending graceful keeps immediate escalation reachable', async () => {
  const f = fixture();
  f.render();
  await f.primary.onclick();
  assert.deepEqual(f.calls, ['after-step']);
  f.render({ canStop: false, canStopNow: true, stop: { mode: 'after-step' } });
  assert.equal(f.primary.disabled, true);
  assert.equal(f.toggle.disabled, false);
  f.toggle.onclick();
  assert.equal(f.menu.hidden, false);
  await f.immediate.onclick();
  assert.deepEqual(f.calls, ['after-step', 'immediate']);
  f.render({ canStop: false, canStopNow: false });
  assert.equal(f.container.hidden, true);
  f.render();
  await f.primary.onclick();
  assert.deepEqual(f.calls, ['after-step', 'immediate', 'after-step']);
});

test('menu supports arrow focus, Escape return and outside dismissal without dispatch', () => {
  const f = fixture();
  f.render();
  let prevented = 0;
  f.toggle.listeners.keydown({ key: 'ArrowDown', preventDefault() { prevented++; } });
  assert.equal(f.document.activeElement, f.immediate);
  assert.equal(f.toggle.attributes['aria-expanded'], 'true');
  f.container.listeners.keydown({ key: 'Escape', preventDefault() { prevented++; }, stopPropagation() {} });
  assert.equal(f.menu.hidden, true);
  assert.equal(f.document.activeElement, f.toggle);
  assert.equal(prevented, 2);
  f.toggle.onclick();
  f.document.listeners.pointerdown({ target: {} });
  assert.equal(f.menu.hidden, true);
  assert.deepEqual(f.calls, []);
});

test('Stop dispatch is single-flight, errors visible, and disconnected or withdrawn controls cannot act', async () => {
  const f = fixture(), release = Promise.withResolvers();
  f.setRequest(async mode => { f.calls.push(mode); await release.promise; throw new Error('Cancellation unconfirmed'); });
  f.render();
  const pending = f.immediate.onclick();
  await f.primary.onclick(); await f.immediate.onclick();
  assert.deepEqual(f.calls, ['immediate']);
  assert.equal(f.toggle.disabled, true);
  release.resolve(); await pending;
  assert.deepEqual(f.errors, ['Cancellation unconfirmed']);
  f.render(undefined, { connected: false });
  await f.primary.onclick(); await f.immediate.onclick(); f.toggle.onclick();
  assert.equal(f.menu.hidden, true);
  f.render({ canStop: false, canStopNow: false });
  await f.immediate.onclick();
  assert.deepEqual(f.calls, ['immediate']);
});
