import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import test from 'node:test';
import { createSampleInput, parseDebuggerInput } from '../public/sketch/debugger.js';
import { designGenerationContract, validateDesign } from '../public/sketch/design-contract.js';
import { createTemplate, createLegacyTemplate, templateCatalog } from '../public/sketch/templates.js';
import { browserAvailable, openFixtureBrowser } from './helpers/browser-fixture.mjs';
import { sharedDesign } from './helpers/shared-design-fixture.mjs';

function designerCollection() {
  const design = sharedDesign();
  for (let index = 0; index < 6; index++) {
    const artifact = createLegacyTemplate(templateCatalog[index % templateCatalog.length].id);
    artifact.id = `custom-artifact-${index}`;
    artifact.title = `Designer artifact ${index}`;
    artifact.description = `  Exact artifact ${index}\n  details & <text>  `;
    design.artifacts.push(artifact);
    design.outcomes[0].references.push(artifact.id);
  }
  return design;
}

function impossibleArtifact() {
  return {
    schemaVersion: 'sketch/v1', id: 'crowded', title: 'Unrenderable final artifact',
    boxes: [
      { id: 'one', label: 'One', x: 0, y: 0, w: 6, h: 3 },
      { id: 'two', label: 'Two', x: 7, y: 0, w: 6, h: 3 },
    ],
    connections: [{ id: 'edge', from: 'one', to: 'two', label: 'W'.repeat(48) }],
  };
}

test('debugger accepts the actual complete Designer contract and every dynamically named artifact', () => {
  const value = designerCollection(), source = ` \n${JSON.stringify(value, null, 3)}\n  `;
  const parsed = parseDebuggerInput(source);
  assert.equal(parsed.mode, 'sketch-design/v1');
  assert.equal(parsed.artifacts.length, 7);
  assert.deepEqual(parsed.value, validateDesign(value));
  assert.deepEqual(parsed.artifacts.map(({ id }) => id), value.artifacts.map(({ id }) => id));
  assert.equal(source, ` \n${JSON.stringify(value, null, 3)}\n  `);
});

test('debugger samples are optional production template data and support raw sketch input', () => {
  const sample = createSampleInput();
  assert.deepEqual(sample.artifacts, templateCatalog.map(({ id }) => createTemplate(id)));
  assert.deepEqual(parseDebuggerInput(JSON.stringify(sample)).value, validateDesign(sample));
  for (const { id } of templateCatalog) {
    const raw = createSampleInput(id);
    assert.deepEqual(raw, createTemplate(id));
    const parsed = parseDebuggerInput(JSON.stringify(raw));
    assert.equal(parsed.mode, 'sketch/v2');
    assert.deepEqual(parsed.artifacts, [raw]);
  }
  assert.throws(() => createSampleInput('unknown'), /Unknown sketch template/);
});

test('debugger reads both document/collection versions explicitly without converting or mixing', () => {
  for (const id of ['workflow', 'architecture', 'ui']) {
    const legacy = createLegacyTemplate(id);
    const source = JSON.stringify(legacy);
    const parsed = parseDebuggerInput(source);
    assert.equal(parsed.mode, 'sketch/v1');
    assert.equal(JSON.stringify(parsed.value), source);
  }
  const current = createSampleInput();
  assert.equal(parseDebuggerInput(JSON.stringify(current)).mode, 'sketch-design/v3');
  current.artifacts[0] = createLegacyTemplate('workflow');
  assert.deepEqual(parseDebuggerInput(JSON.stringify(current)).value, current);
});

test('debugger never extracts a valid artifact from invalid JSON, schema, references, or layouts', () => {
  assert.throws(() => parseDebuggerInput('{"schemaVersion":'), SyntaxError);
  assert.throws(() => parseDebuggerInput(JSON.stringify({ content: sharedDesign() })), /sketch-design\/v3/);
  const schema = sharedDesign();
  schema.unexpected = true;
  assert.throws(() => parseDebuggerInput(JSON.stringify(schema)), { name: 'SketchValidationError' });
  const references = designerCollection();
  references.outcomes[0].references.push('missing-artifact#missing-box');
  assert.throws(() => parseDebuggerInput(JSON.stringify(references)), { code: 'reference' });
  const layout = designerCollection();
  layout.artifacts.push(impossibleArtifact());
  assert.throws(() => parseDebuggerInput(JSON.stringify(layout)), { name: 'SketchLayoutError', code: 'layout' });
  assert.throws(() => parseDebuggerInput(JSON.stringify(impossibleArtifact())), { code: 'layout' });
});

async function openDebugger(t) {
  const publicRoot = new URL('../public/sketch/', import.meta.url);
  const files = new Map(await Promise.all([
    'contract.js', 'design-contract.js', 'renderer.js', 'geometry-v2.js', 'icons.js', 'templates.js', 'example.html', 'debugger.js',
  ].map(async (name) => [`/${name}`, await readFile(new URL(name, publicRoot), 'utf8')])));
  for (const name of ['human-loop.js', 'human-loop.json']) {
    files.set(`/prompts/${name}`, await readFile(new URL(`../prompts/${name}`, publicRoot), 'utf8'));
  }
  const requests = [];
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    requests.push(path);
    if (path.startsWith('/sketch/')) {
      const value = files.get(path.slice('/sketch'.length));
      if (value) files.set(path, value);
    }
    if (path.startsWith('/artifacts/') && !files.has(path)) {
      try { files.set(path, await readFile(new URL(`..${path}`, publicRoot), 'utf8')); }
      catch { response.writeHead(404).end(); return; }
    }
    if (!files.has(path)) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', path.endsWith('.json') ? 'application/json' : path.endsWith('.js') ? 'text/javascript' : 'text/html');
    response.end(files.get(path));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const browser = await openFixtureBrowser(t);
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/example.html` });
  await browser.waitFor("document.querySelector('#validation-status')?.textContent.startsWith('Valid sketch-design/v3')");
  return { browser, requests };
}

async function pasteInput(browser, source) {
  await browser.evaluate(`(() => {
    const editor = document.getElementById('json-input');
    editor.focus();
    editor.select();
  })()`);
  await browser.call('Input.insertText', { text: source });
  assert.equal(await browser.evaluate("document.getElementById('json-input').value"), source);
  assert.equal(await browser.evaluate("document.querySelectorAll('[data-sketch-id]').length"), 0,
    'Editing removes stale rendered output before validation');
  await browser.evaluate("document.getElementById('validate-input').click()");
}

test('real Edge standalone debugger pastes complete Designer output, switches every artifact, and exposes errors safely',
  { skip: !browserAvailable, timeout: 90_000 }, async (t) => {
    const { browser, requests } = await openDebugger(t);
    assert.deepEqual(await browser.evaluate("JSON.parse(document.getElementById('generation-contract').textContent)"),
      designGenerationContract);
    assert.ok(requests.includes('/prompts/human-loop.json'), 'Debugger imports the actual shared JSON asset');
    const design = designerCollection();
    const exactLabel = '<img src=x>';
    const exactDetails = '  Full details\n</pre><img src=x onerror="window.debuggerInjected=true"><script>window.debuggerInjected=true</script>\n  原文 & text  ';
    design.artifacts[0].boxes.find(({ id }) => id === 'prepare').label = exactLabel;
    design.artifacts[0].boxes.find(({ id }) => id === 'prepare').details = exactDetails;
    design.artifacts[0].connections[0].details = exactDetails;
    const source = ` \n${JSON.stringify(design, null, 3)}\n  `;
    await pasteInput(browser, source);
    assert.deepEqual(await browser.evaluate(
      "[...document.getElementById('artifact-select').options].map(option => option.value)"),
    design.artifacts.map(({ id }) => id));
    assert.match(await browser.evaluate("document.getElementById('validation-status').textContent"), /7 artifact/);
    assert.deepEqual(await browser.evaluate("JSON.parse(document.getElementById('design-details').textContent)"),
      { goal: design.goal, summary: design.summary, outcomes: design.outcomes });
    for (const artifact of [...design.artifacts].reverse()) {
      const selected = await browser.evaluate(`(() => {
        const selector = document.getElementById('artifact-select');
        selector.value = ${JSON.stringify(artifact.id)};
        selector.dispatchEvent(new Event('change'));
        return {
          rendered: [...document.querySelectorAll('[data-sketch-id]')].map(node => node.dataset.sketchId),
          details: document.getElementById('details').textContent,
          label: document.getElementById('selection-label').textContent,
          reference: document.getElementById('selection-reference').textContent,
          source: document.getElementById('json-input').value,
        };
      })()`);
      assert.deepEqual(selected, {
        rendered: [artifact.id], details: artifact.description ?? '', label: artifact.title, reference: artifact.id, source,
      });
    }
    for (const [selector, reference, label] of [
      ['[data-sketch-box="prepare"]', 'interaction#prepare', exactLabel],
      ['[data-sketch-connection="handoff-request"]', 'interaction#handoff-request', 'Send'],
    ]) {
      const selected = await browser.evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        element.focus();
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return {
          reference: document.getElementById('selection-reference').textContent,
          label: document.getElementById('selection-label').textContent,
          details: document.getElementById('details').textContent,
          unsafe: document.querySelectorAll('#details img, #details script, #preview img, #preview script, foreignObject').length,
          injected: window.debuggerInjected === true,
        };
      })()`);
      assert.deepEqual(selected, { reference, label, details: exactDetails, unsafe: 0, injected: false });
    }

    for (const [theme, textColor] of [['dark', 'rgb(232, 237, 244)'], ['light', 'rgb(24, 32, 42)']]) {
      const actual = await browser.evaluate(`(() => {
        const selector = document.getElementById('theme-select');
        selector.value = '${theme}';
        selector.dispatchEvent(new Event('change'));
        return getComputedStyle(document.querySelector('.shared-sketch .sketch-node-title')).fill;
      })()`);
      assert.equal(actual, textColor);
    }
    await browser.call('Emulation.setDeviceMetricsOverride', { width: 320, height: 700, deviceScaleFactor: 1, mobile: false });
    const bounds = await browser.evaluate(`(() => {
      const figure = document.querySelector('.shared-sketch');
      figure.scrollLeft = 100000;
      return { width: document.documentElement.scrollWidth, viewport: innerWidth,
        client: figure.clientWidth, scroll: figure.scrollWidth, offset: figure.scrollLeft,
        height: figure.clientHeight, viewportHeight: innerHeight,
        detailsHeight: document.getElementById('details').clientHeight,
        font: parseFloat(getComputedStyle(figure.querySelector('text')).fontSize) };
    })()`);
    assert.ok(bounds.width <= bounds.viewport, 'The editor, details, and preview cannot widen the page');
    assert.ok(bounds.client < bounds.scroll && bounds.offset > 0, 'Large geometry scrolls instead of shrinking text');
    assert.ok(bounds.height <= bounds.viewportHeight * .55 + 1);
    assert.ok(bounds.detailsHeight <= bounds.viewportHeight * .3 + 1);
    assert.equal(bounds.font, 14);

    const invalidReference = designerCollection();
    invalidReference.outcomes[0].references.push('not-present#box');
    const invalidLayout = designerCollection();
    invalidLayout.artifacts.push(impossibleArtifact());
    const invalidSchema = designerCollection();
    invalidSchema.artifacts.at(-1).unknown = 'unsupported';
    for (const [invalidSource, expected] of [
      ['{ "artifacts": [', /JSON parse error/],
      [JSON.stringify(invalidSchema), /SketchValidationError/],
      [JSON.stringify(invalidReference), /\[reference\].*not-present#box/],
      [JSON.stringify(invalidLayout), /\[layout\].*edge/],
      [JSON.stringify(impossibleArtifact()), /\[layout\]/],
    ]) {
      await pasteInput(browser, invalidSource);
      const result = await browser.evaluate(`({
        source: document.getElementById('json-input').value,
        error: document.getElementById('validation-error').textContent,
        hidden: document.getElementById('validation-error').hidden,
        invalid: document.getElementById('json-input').getAttribute('aria-invalid'),
        disabled: document.getElementById('artifact-select').disabled,
        options: document.getElementById('artifact-select').options.length,
        rendered: document.querySelectorAll('[data-sketch-id]').length,
        details: document.getElementById('details').textContent,
      })`);
      assert.equal(result.source, invalidSource);
      assert.match(result.error, expected);
      assert.deepEqual({ ...result, source: '', error: '' }, {
        source: '', error: '', hidden: false, invalid: 'true', disabled: true, options: 0, rendered: 0, details: '',
      });
    }
    const raw = createTemplate('architecture'), rawSource = `\n${JSON.stringify(raw)}\n`;
    await pasteInput(browser, rawSource);
    assert.equal(await browser.evaluate("document.querySelector('[data-sketch-id]').dataset.sketchId"), raw.id);
    assert.equal(await browser.evaluate("document.getElementById('artifact-select').options.length"), 1);
    assert.equal(await browser.evaluate("document.getElementById('validation-error').hidden"), true);
    assert.equal(await browser.evaluate("document.getElementById('design-details').textContent"), '');
    assert.match(await browser.evaluate("document.getElementById('validation-status').textContent"), /Valid sketch\/v2/);
    await browser.evaluate(`(() => {
      const element = document.querySelector('[data-sketch-box="api"]');
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    const api = raw.boxes.find(({ id }) => id === 'api');
    assert.deepEqual(await browser.evaluate(`({
      label: document.getElementById('selection-label').textContent,
      caption: document.getElementById('selection-caption').textContent,
      body: document.getElementById('selection-body').textContent,
      details: document.getElementById('details').textContent,
      reference: document.getElementById('selection-reference').textContent,
    })`), { label: api.label, caption: api.caption, body: api.body,
      details: api.details ?? '', reference: `${raw.id}#api` });
    await browser.evaluate(`(() => {
      document.getElementById('sample-select').value = 'collection';
      document.getElementById('load-sample').click();
    })()`);
    assert.deepEqual(await browser.evaluate("JSON.parse(document.getElementById('json-input').value)"), createSampleInput());
    assert.equal(browser.exceptions.length, 0);
    assert.ok(requests.every((path) => /^\/(?:example\.html|(?:sketch\/)?(?:debugger|contract|design-contract|renderer|geometry-v2|icons|templates)\.js|artifacts\/[\w/.-]+|prompts\/human-loop\.(?:js|json)|favicon\.ico)$/.test(path)),
      'Standalone debugger requests only its static resources, never an API or native workflow');
  });
