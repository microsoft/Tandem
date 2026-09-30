import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import test from 'node:test';
import { browserAvailable, openFixtureBrowser } from './helpers/browser-fixture.mjs';

const publicRoot = resolve(import.meta.dirname, '../public');
const source = {
  role: 'designer', resultId: 'design-result', requestId: 'request-1', requestIds: ['request-1'],
  cycleId: null, design: { revisionId: null, digest: null }, planDigest: null,
};
function snapshot(status) {
  return {
    schemaVersion: 'human-loop-snapshot-view/v1', streamId: 'theme-fixture',
    installation: { status: 'ready' }, design: null, processes: { apps: [], commands: [] },
    workflow: {
      schemaVersion: 'human-loop-view/v1', status,
      reason: status === 'execution-unknown' ? 'Execution needs inspection; no completion is claimed.' : null,
      activeRole: null, activeRequestId: null, workspacePath: 'theme-fixture',
      currentCycle: { id: 'cycle-1', originRequestId: 'request-1', phase: 'implementing', completed: 1, total: 2,
        plan: { id: 'plan-1', version: 1, goal: 'A tiny tank game', tasks: [] },
        tasks: [{ id: 'engine', title: 'Game engine', status: 'completed' },
          { id: 'interface', title: 'Browser interface', status: 'pending' }] },
      questionInteraction: status === 'waiting-answer' ? {
        resultId: source.resultId, source, canAnswer: true,
        questions: [{ id: 'aim', context: 'Keyboard controls', question: 'Choose an aiming style.',
          whyItMatters: 'This changes how aiming keys behave.', importance: 'blocking',
          options: [{ id: 'stepped', label: 'Stepped', implication: 'One increment per press.' },
            { id: 'continuous', label: 'Continuous', implication: 'Rotate while held.' }],
          allowFreeform: true, state: 'open', answerRequestId: null, source }],
      } : null,
      queue: [], lastHandoff: { id: 'handoff-1', role: 'designer', kind: 'designer-unchanged',
        summary: 'The existing game Design remains current.', findings: [], verificationLimits: [] },
      canStop: status === 'waiting-answer', canSend: status === 'waiting-answer',
    },
    messages: [
      { id: 'user-1', kind: 'user', requestId: 'request-1', text: 'Build the tiny tank game.',
        timestamp: '2026-09-15T08:00:00Z', queueState: 'completed' },
      { id: 'assistant-1', kind: 'assistant', role: 'implementer', requestId: 'request-1',
        text: 'The engine is implemented. The browser interface is the remaining task.',
        timestamp: '2026-09-15T08:00:01Z' },
    ],
    events: [{ type: 'human.internal-task', sequence: 1, source: 'system',
      summary: '1 / 2 tasks completed', timestamp: '2026-09-15T08:00:01Z',
      data: { role: 'implementer', requestId: 'request-1' } }],
    accessRequests: [{ id: 'permission-1', title: 'Run the scoped check?',
      description: 'node --check game.js in the project working copy.',
      scopes: ['custom tool', 'run_workflow_command'], canApproveForSession: false, canApproveAll: false }],
  };
}

async function fixture(t) {
  let current = snapshot('execution-unknown');
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://127.0.0.1').pathname;
      if (path === '/api/settings') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ preferences: { theme: 'system', fontSize: 'normal' },
          model: { models: [], actual: null, canChange: false, reason: 'Private model selection becomes available when Ready.' } })); return;
      }
      if (path === '/api/snapshot') {
        const { questionInteraction, ...workflow } = current.workflow;
        const questionInteractions = questionInteraction ? [{ ...questionInteraction,
          questions: questionInteraction.questions.map(q => ({ ...q, blockingActive: q.importance === 'blocking' })) }] : [];
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ...current, workflow: { ...workflow, questionInteractions } })); return;
      }
      if (path === '/api/events') {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write('event: update\ndata: {}\n\n'); return;
      }
      if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
      const file = resolve(publicRoot, path === '/' ? 'human-loop.html' : path.slice(1));
      if (!file.startsWith(publicRoot + sep)) { response.writeHead(403); response.end(); return; }
      const body = await readFile(file);
      response.writeHead(200, { 'content-type': { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' }[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500); response.end(error.message); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const cleanups = [];
  t.after(async () => { for (const cleanup of cleanups) await cleanup(); server.closeAllConnections(); await new Promise(done => server.close(done)); });
  const browser = await openFixtureBrowser({ after: (cleanup) => cleanups.push(cleanup) });
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 870, height: 990, deviceScaleFactor: 1, mobile: false });
  const url = `http://127.0.0.1:${server.address().port}/`;
  async function show(status, importance = 'blocking', titles) {
    current = snapshot(status);
    if (current.workflow.questionInteraction) current.workflow.questionInteraction.questions[0].importance = importance;
    if (titles) {
      const original = current.workflow.questionInteraction.questions[0];
      current.workflow.questionInteraction.questions = titles.map((question, index) => ({
        ...structuredClone(original), id: `question-${index}`, question,
      }));
    }
    await browser.call('Page.navigate', { url });
    await browser.waitFor(`document.querySelector('#human-workflow > .human-loop')?.dataset.status === ${JSON.stringify(status)}
      && document.querySelector('.conversation-entry .conversation-text')`);
  }
  return { browser, show };
}

async function theme(browser, preference, host) {
  await browser.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: preference }] });
  await browser.evaluate(`(() => {
    const root=document.documentElement; root.removeAttribute('style');
    const host=${JSON.stringify(host)};
    if(host)for(const [key,value] of Object.entries(host))root.style.setProperty(key,value);
  })()`);
}

async function measure(browser, selectors) {
  return browser.evaluate(`(() => {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    function rgb(color){context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data].map((v,i)=>i===3?v/255:v);}
    function background(node){
      const color=rgb(getComputedStyle(node).backgroundColor);
      if(color[3]===1)return color;
      const parent=node.parentElement?background(node.parentElement):[255,255,255,1];
      return [...color.slice(0,3).map((v,i)=>v*color[3]+parent[i]*(1-color[3])),1];
    }
    function light(color){return color.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);}
    return ${JSON.stringify(selectors)}.map(selector=>{
      const [target,pseudo]=selector.split('::');
      const node=document.querySelector(target);if(!node)throw new Error('Missing '+selector);
      const property=['outlineColor','borderTopColor'].includes(pseudo)?pseudo:'color';
      const color=rgb(getComputedStyle(node,property==='color'&&pseudo?'::'+pseudo:null)[property]), surface=background(node);
      const a=light(color), b=light(surface);
      return {selector,color,surface,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    });
  })()`);
}

test('complete human-loop stylesheet stack preserves theme pairs and readable content', {
  skip: !browserAvailable,
}, async t => {
  const { browser, show } = await fixture(t);
  const hosts = {
    light: { '--background-color-default': '#f8efe8', '--text-color-default': '#302536', '--border-color-default': '#c9bcb5' },
    dark: { '--background-color-default': '#1b1824', '--text-color-default': '#e5dce1', '--border-color-default': '#494352' },
  };
  const cases = [
    ['light fallback', 'light', null, false], ['dark fallback', 'dark', null, true],
    ['light host / light OS', 'light', hosts.light, false], ['dark host / dark OS', 'dark', hosts.dark, true],
    ['light host / dark OS', 'dark', hosts.light, false], ['dark host / light OS', 'light', hosts.dark, true],
  ];
  for (const status of ['execution-unknown', 'waiting-answer']) {
    await show(status);
    for (const [name, preference, host, dark] of cases) await t.test(`${status}: ${name}`, async () => {
      await theme(browser, preference, host);
      const selectors = ['.human-header .brand-slogan', '#project-name', '#current-state',
        '.conversation-entry header strong', '.conversation-entry time', '.conversation-text',
        '#current-state-title', '.human-loop details summary', '#open-diagnostics',
        '.human-design h2', '#assessment-card strong', '#message', '#message::placeholder',
        '.access-card h3', '.access-card p', '.access-card button', '#notice'];
      if (status === 'waiting-answer') selectors.push('.human-loop-question-title', '.human-loop select', '.human-loop textarea',
        '.human-loop-questions > h3', '.human-loop-question-help', '.human-loop-question-status', '.human-loop-questions li',
        '.question-meaning');
      const values = await measure(browser, selectors);
      assert.deepEqual(values.filter(value => value.contrast < 4.5), [], `All enabled text needs 4.5:1 contrast: ${JSON.stringify(values)}`);
      const surfaces = values.filter(value => ['.human-header .brand-slogan', '.conversation-text', '#current-state-title', '#assessment-card strong'].includes(value.selector));
      assert.ok(surfaces.every(value => dark ? Math.max(...value.surface.slice(0, 3)) < 100 : Math.min(...value.surface.slice(0, 3)) > 180),
        `Shell and shared cards must follow the same palette: ${JSON.stringify(surfaces)}`);
      if (process.env.HUMAN_LOOP_THEME_SCREENSHOTS && status === 'execution-unknown'
        && ['light host / dark OS', 'dark host / light OS'].includes(name)) {
        const directory = resolve(process.env.HUMAN_LOOP_THEME_SCREENSHOTS);
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, `${dark ? 'dark' : 'light'}-host.png`), await browser.screenshot());
      }
    });
  }
  assert.equal(await browser.evaluate('getComputedStyle(document.body).paddingBottom'), '0px',
    'The inline composer must not inherit the old fixed-composer padding.');
  assert.deepEqual(browser.exceptions, []);
});

test('question cards retain boundaries without a duplicate wrapper, readable hierarchy and keyboard focus in narrow themes',
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const { browser, show } = await fixture(t);
    for (const preference of ['light', 'dark']) {
      await show('waiting-answer', preference === 'dark' ? 'advisory' : 'blocking');
      await theme(browser, preference, null);
      await browser.evaluate(`(() => {
        if(document.querySelector('#question-panel').hidden) document.querySelector('#show-questions').click();
        document.querySelector('.human-loop-question-group').open=true;
      })()`);
      const semantics = await measure(browser, ['.question-meaning']);
      assert.ok(semantics.length && semantics.every(value => value.contrast >= 4.5), JSON.stringify(semantics));
      if (process.env.HUMAN_LOOP_THEME_SCREENSHOTS) {
        await browser.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 1100, deviceScaleFactor: 1, mobile: false });
        await browser.evaluate(`(() => {
          const scroller=document.querySelector('#question-panel'),card=document.querySelector('.human-loop-questions');
          scroller.scrollTop+=card.getBoundingClientRect().top-scroller.getBoundingClientRect().top-12;
        })()`);
        const directory = resolve(process.env.HUMAN_LOOP_THEME_SCREENSHOTS);
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, `questions-${preference}-overview.png`), await browser.screenshot());
      }
      await browser.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
      await browser.evaluate(`(() => {
        const original=document.querySelector('.human-loop-questions > button');
        original.scrollIntoView({block:'center'});original.focus();
      })()`);
      await browser.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await browser.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      const appearance = await browser.evaluate(`(() => {
        const card=document.querySelector('.human-loop-questions'),select=card.querySelector('select');
        const style=getComputedStyle(select),box=card.getBoundingClientRect();
        return {active:document.activeElement===select,focus:select.matches(':focus-visible'),
          outline:style.outlineStyle,outlineWidth:parseFloat(style.outlineWidth),outlineMatchesText:style.outlineColor===style.color,
          wrapperBorder:getComputedStyle(card).borderTopWidth,wrapperPadding:getComputedStyle(card).paddingLeft,
          cardBorder:getComputedStyle(card.querySelector('fieldset')).borderTopWidth,
          surface:getComputedStyle(card.querySelector('fieldset')).backgroundColor,parent:getComputedStyle(card).backgroundColor,
          heading:parseFloat(getComputedStyle(card.querySelector('h3')).fontSize),
          question:parseFloat(getComputedStyle(card.querySelector('.human-loop-question-title')).fontSize),
          text:parseFloat(getComputedStyle(card).fontSize),controlHeight:select.getBoundingClientRect().height,
          status:card.querySelector('.question-meaning').textContent,
          overflow:document.documentElement.scrollWidth>innerWidth,
          controlFits:select.getBoundingClientRect().right<=box.right,
          help:card.querySelector('.human-loop-question-help').textContent};
      })()`);
      assert.ok(appearance.active && appearance.focus);
      assert.equal(appearance.outline, 'solid'); assert.ok(appearance.outlineWidth >= 2);
      const boundaries = await measure(browser, ['.human-loop select::outlineColor', '.human-loop select::borderTopColor']);
      assert.ok(boundaries.every(({ contrast }) => contrast >= 3), JSON.stringify(boundaries));
      assert.notEqual(appearance.surface, appearance.parent);
      assert.equal(appearance.wrapperBorder, '0px'); assert.equal(appearance.wrapperPadding, '0px');
      assert.equal(appearance.cardBorder, '1px');
      assert.ok(appearance.heading >= 18 && appearance.question >= 16 && appearance.text >= 14, JSON.stringify(appearance));
      assert.ok(appearance.controlHeight >= 44 && appearance.controlFits && !appearance.overflow);
      assert.match(appearance.status, preference === 'dark' ? /Advisory.*optional/ : /Blocking.*required/);
      assert.match(appearance.help, /unselected questions stay unanswered.*Ordinary messages do not resolve/);
      const values = await measure(browser, ['.human-loop-questions > h3', '.human-loop-question-title',
        '.human-loop-question-help', '.human-loop-question-status', '.human-loop select', '.human-loop textarea', '.human-loop-questions li']);
      assert.deepEqual(values.filter(value => value.contrast < 4.5), [], JSON.stringify(values));
      if (process.env.HUMAN_LOOP_THEME_SCREENSHOTS) {
        const directory = resolve(process.env.HUMAN_LOOP_THEME_SCREENSHOTS);
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, `questions-${preference}-narrow.png`), await browser.screenshot());
        await writeFile(join(directory, `questions-${preference}-contrast.json`), JSON.stringify({ appearance, values }, null, 2));
      }
    }
    assert.deepEqual(browser.exceptions, []);
  });

test('question titles and quiet metadata stay inside individually named cards', {
  skip: !browserAvailable, timeout: 60_000,
}, async t => {
  const { browser, show } = await fixture(t);
  const titles = [
    'When you change the default checklist, what should happen to days that already have a saved record?',
    'Choose an aiming style.',
  ];
  const baseline = process.env.QUESTION_CARD_BASELINE === '1';
  const directory = process.env.QUESTION_CARD_EVIDENCE;
  if (directory) await mkdir(directory, { recursive: true });
  const evidence = [];
  for (const width of [1280, 390, 320]) for (const preference of ['light', 'dark']) {
    await show('waiting-answer', 'blocking', titles);
    await theme(browser, preference, null);
    await browser.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
    const cards = await browser.evaluate(`(() => [...document.querySelectorAll('.human-loop-questions fieldset')].map(field => {
      const heading=field.querySelector('.human-loop-question-title, legend'),status=field.querySelector('.human-loop-question-status');
      const rect=n=>n.getBoundingClientRect().toJSON(),s=getComputedStyle(heading),metadata=getComputedStyle(status);
      return {field:rect(field),heading:rect(heading),status:rect(status),text:heading.textContent,tag:heading.tagName,
        id:heading.id,labelledBy:field.getAttribute('aria-labelledby'),fontSize:parseFloat(s.fontSize),
        lineHeight:parseFloat(s.lineHeight),weight:s.fontWeight,statusText:status.textContent,
        statusBorder:metadata.borderTopWidth,statusBackground:metadata.backgroundColor,statusWeight:metadata.fontWeight,
        selectLabel:field.querySelector('select').getAttribute('aria-label'),
        textareaLabel:field.querySelector('textarea').getAttribute('aria-label'),
        clipped:field.scrollWidth>field.clientWidth,pageOverflow:document.documentElement.scrollWidth>innerWidth};
    }))()`);
    assert.equal(cards.length, 2);
    for (const [index, card] of cards.entries()) {
      assert.equal(card.text, titles[index]);
      assert.equal(card.statusText, 'open');
      assert.equal(card.selectLabel, `Answer choice: ${titles[index]}`);
      assert.equal(card.textareaLabel, `Your own answer: ${titles[index]}`);
      assert.equal(card.clipped, false);
      assert.equal(card.pageOverflow, false);
      if (!baseline) {
        assert.equal(card.tag, 'H4');
        assert.ok(card.id);
        assert.equal(card.labelledBy, card.id);
        assert.ok(card.heading.top >= card.field.top + 10);
        assert.ok(card.heading.left >= card.field.left + 10 && card.heading.right <= card.field.right - 10);
        assert.ok(card.status.top >= card.heading.bottom + 4);
        assert.ok(card.fontSize >= 16 && card.fontSize <= 18 && card.lineHeight >= 24, JSON.stringify(card));
        assert.equal(card.weight, '600');
        assert.equal(card.statusBorder, '0px');
        assert.equal(card.statusBackground, 'rgba(0, 0, 0, 0)');
        assert.equal(card.statusWeight, '400');
      }
      await browser.evaluate(`document.querySelectorAll('.human-loop-questions fieldset')[${index}].scrollIntoView({block:'start',behavior:'instant'})`);
      await browser.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
      const visible = await browser.evaluate(`(() => {
        const field=document.querySelectorAll('.human-loop-questions fieldset')[${index}];
        const heading=field.querySelector('.human-loop-question-title, legend').getBoundingClientRect();
        const status=field.querySelector('.human-loop-question-status').getBoundingClientRect();
        const r=document.querySelector('#question-panel').getBoundingClientRect();
        const x=Math.max(0,r.x),y=Math.max(0,r.y),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);
        return {headingTop:heading.top,headingBottom:heading.bottom,statusBottom:status.bottom,top:y,bottom,
          clip:{x:x+scrollX,y:y+scrollY,width:right-x,height:bottom-y,scale:1}};
      })()`);
      assert.ok(visible.headingTop >= visible.top && visible.statusBottom <= visible.bottom, JSON.stringify(visible));
      card.visibleAfterReveal = visible;
      if (directory) {
        const image = await browser.call('Page.captureScreenshot', { format: 'png', clip: visible.clip });
        await writeFile(join(directory, `question-${index}-${width}-${preference}.png`), Buffer.from(image.data, 'base64'));
      }
      await browser.evaluate(`document.querySelectorAll('.human-loop-questions fieldset')[${index}].querySelector('select').focus()`);
      for (const type of ['keyDown', 'keyUp']) await browser.call('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      assert.equal(await browser.evaluate("document.activeElement.getAttribute('aria-label')"), `Your own answer: ${titles[index]}`);
      assert.equal(await browser.evaluate("getComputedStyle(document.activeElement).outlineStyle"), 'solid');
    }
    assert.ok(cards[1].field.top > cards[0].field.bottom);
    if (!baseline) assert.notEqual(cards[0].id, cards[1].id);
    const tree = await browser.call('Accessibility.getFullAXTree');
    const groupNames = tree.nodes.filter(node => node.role?.value === 'group').map(node => node.name?.value);
    for (const title of titles) assert.ok(groupNames.includes(title), JSON.stringify(groupNames));
    evidence.push({ width, preference, cards, groupNames });
  }
  if (directory) await writeFile(join(directory, 'layout.json'), JSON.stringify(evidence, null, 2));
  assert.deepEqual(browser.exceptions, []);
});

test('explicit settings override opposing Host colors, scale readable text without zoom, and retain control contrast', {
  skip: !browserAvailable, timeout: 60_000,
}, async (t) => {
  const { browser, show } = await fixture(t);
  await show('execution-unknown');
  await browser.evaluate("document.querySelector('#canvas-settings').open=true;new Promise(done=>setTimeout(done,100))");
  for (const selected of ['light', 'dark']) {
    await theme(browser, selected === 'dark' ? 'light' : 'dark', {
      '--background-color-default': selected === 'dark' ? '#ffffff' : '#101010',
      '--text-color-default': selected === 'dark' ? '#101010' : '#ffffff',
    });
    for (const [fontSize, expected, documentSize] of [['normal', 14, 16], ['larger', 16, 18], ['largest', 18, 20]]) {
      await browser.evaluate(`(() => {
        document.body.dataset.theme=${JSON.stringify(selected)};
        document.body.dataset.fontSize=${JSON.stringify(fontSize)};
        document.querySelector('#setting-theme').value=${JSON.stringify(selected)};
        document.querySelector('#setting-font').value=${JSON.stringify(fontSize)};
        document.querySelector('#canvas-settings').open=true;
        document.querySelector('#setting-theme').focus();
      })()`);
      await browser.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
      const sizes = await browser.evaluate(`(() => {
        const style=getComputedStyle(document.body);
        return {text:parseFloat(getComputedStyle(document.querySelector('#message')).fontSize),
          document:parseFloat(style.getPropertyValue('--artifact-document-font-size')),
          zoom:style.zoom,scheme:style.colorScheme,overflow:document.documentElement.scrollWidth>innerWidth};
      })()`);
      assert.equal(sizes.text, expected); assert.equal(sizes.document, documentSize);
      assert.equal(sizes.zoom, '1'); assert.equal(sizes.scheme, selected); assert.equal(sizes.overflow, false);
      const text = await measure(browser, ['#setting-theme', '#setting-font', '#save-appearance', '#model-setting-status', '#settings-error']);
      assert.ok(text.every(({ contrast }) => contrast >= 4.5), JSON.stringify(text));
      const boundaries = await measure(browser, ['#setting-theme::borderTopColor', '#setting-theme::outlineColor', '#save-appearance::borderTopColor']);
      assert.ok(boundaries.every(({ contrast }) => contrast >= 3), JSON.stringify(boundaries));
      if (process.env.HUMAN_LOOP_THEME_SCREENSHOTS && fontSize === 'larger') {
        await writeFile(join(resolve(process.env.HUMAN_LOOP_THEME_SCREENSHOTS), `settings-${selected}-narrow.png`), await browser.screenshot());
      }
    }
  }
});
