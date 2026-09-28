import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import test from 'node:test';
import { browserAvailable, openFixtureBrowser } from './helpers/browser-fixture.mjs';
import { policyHash } from '../runtime-src/domain/workflow/policy.ts';

const publicRoot = resolve(import.meta.dirname, '../public');
const sourcePath = process.env.DAILY_REPLAY_SNAPSHOT;
const longQuestion = 'When you change the default checklist, what should happen to days that already have a saved record?';

// One sequential renderer replay. HTTP acknowledgements and workflow events are
// deterministic fixture data, not an SDK session or native lifecycle evidence.
test('daily checklist and note shell journey (deterministic renderer replay, not native E2E)',
  { skip: !browserAvailable || !sourcePath, timeout: 240_000 }, async t => {
    const captured = JSON.parse(await readFile(sourcePath, 'utf8'));
    const content = captured.design?.content ?? captured.content ?? captured;
    assert.ok(content.artifacts?.length, 'Provide the captured daily design, without rewriting its source.');
    const provenance = content.artifacts.map(({ id, format, source }) => ({
      id, format, sha256: createHash('sha256').update(source).digest('hex'),
    }));
    content.artifacts.push({ schemaVersion: 'artifact/v2', format: 'markdown', id: 'replay-step-note',
      title: 'Replay step note', category: 'user-story', noteForArtifactId: 'daily-journey',
      source: '## Planning to reflection\n\nSynthetic replay companion: review the checklist, save the daily note, and revisit saved records.' });
    const binding = { revisionId: 'replay-00000000-0000-4000-8000-000000000001', digest: policyHash(content) };
    const current = {
      schemaVersion: 'human-loop-snapshot-view/v1', streamId: 'daily-replay',
      installation: { status: 'ready', canStart: false, canReopen: false },
      design: null, messages: [], events: [], accessRequests: [], processes: { apps: [], commands: [] },
      workflow: { schemaVersion: 'human-loop-view/v1', status: 'ready', reason: null,
        activeRequestId: null, activeRole: null, workspacePath: 'Daily checklist replay',
        currentCycle: null, lastHandoff: null, queue: [], canStop: false, canSend: true, questionInteraction: null },
    };
    const posts = [], streams = new Set(), preferences = { theme: 'light', fontSize: 'normal' };
    let failNext = false;
    const server = createServer(async (request, response) => {
      try {
        const path = new URL(request.url, 'http://127.0.0.1').pathname;
        if (path === '/api/events') {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.write('event: update\ndata: {}\n\n');
          streams.add(response); request.on('close', () => streams.delete(response)); return;
        }
        if (request.method === 'POST') {
          const chunks = []; for await (const chunk of request) chunks.push(chunk);
          const data = JSON.parse(Buffer.concat(chunks)); posts.push({ path, data });
          response.writeHead(failNext ? 503 : 200, { 'content-type': 'application/json' });
          if (failNext) { failNext = false; response.end(JSON.stringify({ error: 'Replay: request temporarily unavailable; your draft is retained.' })); return; }
          if (path === '/api/requests') {
            current.messages.push({ id: data.id, requestId: data.id, kind: 'user', text: data.message,
              timestamp: new Date().toISOString(), queueState: 'active' });
            Object.assign(current.workflow, { status: 'working', activeRole: 'designer', activeRequestId: data.id, canStop: true });
          }
          if (path === '/api/answers') {
            current.messages.push({ id: `answers:${data.id}`, requestId: data.id, kind: 'user',
              text: 'Question form submission.', timestamp: new Date().toISOString(),
              answerDetails: data.answers.answers.map(answer => {
                const question = current.workflow.questionInteraction.questions.find(item => item.id === answer.questionId);
                return { questionId: answer.questionId, sourceResultId: answer.sourceResultId,
                  question: question.question, role: 'designer', answer: answer.kind === 'option'
                    ? question.options.find(option => option.id === answer.value).label : answer.value };
              }) });
            current.messages.push({ id: 'unaccepted-answer', requestId: 'unaccepted-answer', kind: 'user',
              text: 'Fixture-only historical answer from a different request.', timestamp: new Date().toISOString(),
              answerDetails: [{ questionId: 'choice-0', sourceResultId: 'questions', role: 'designer',
                question: longQuestion, answer: 'Different request must not replace the accepted answer.' }] });
            current.workflow.questionInteraction.questions.forEach(question => {
              question.state = 'answered'; question.answerRequestId = data.id;
            });
            current.workflow.questionInteraction.canAnswer = false;
            current.workflow.status = 'ready'; current.workflow.canStop = false;
          }
          if (path.startsWith('/api/access/')) current.accessRequests = current.accessRequests.filter(item => item.id !== decodeURIComponent(path.split('/').at(-1)));
          response.end(JSON.stringify({ requestId: data.id })); return;
        }
        const value = path === '/api/snapshot' ? current : path === '/api/settings'
          ? { preferences, model: { models: [], actual: null, canChange: false, reason: 'Replay only.' } } : null;
        if (value) { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); return; }
        const file = resolve(publicRoot, path === '/' ? 'human-loop.html' : path.slice(1));
        if (!file.startsWith(publicRoot + sep)) throw new Error('Outside replay assets.');
        const body = await readFile(file);
        response.writeHead(200, { 'content-type': { '.html': 'text/html', '.css': 'text/css',
          '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' }[extname(file)] ?? 'application/octet-stream' });
        response.end(body);
      } catch (error) { response.writeHead(500); response.end(error.message); }
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const scratch = resolve(`.daily-replay-browser-${process.pid}`);
    await mkdir(scratch, { recursive: true });
    const previous = { TMP: process.env.TMP, TEMP: process.env.TEMP, TMPDIR: process.env.TMPDIR };
    process.env.TMP = process.env.TEMP = process.env.TMPDIR = scratch;
    const cleanups = [];
    t.after(async () => {
      for (const cleanup of cleanups) await cleanup();
      server.closeAllConnections(); await new Promise(done => server.close(done));
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    const browser = await openFixtureBrowser({ after: cleanup => cleanups.push(cleanup) });
    const evidence = process.env.DAILY_REPLAY_EVIDENCE;
    if (evidence) await mkdir(evidence, { recursive: true });
    if (evidence) await writeFile(join(evidence, 'provenance.json'), JSON.stringify({
      kind: 'deterministic renderer replay, not native E2E', capturedSource: sourcePath,
      originalArtifacts: provenance, synthetic: ['step-note companion', 'conversation, questions, workflow, permission and HTTP acknowledgements'],
      streamingLimit: 'Append-only assistant messages arrive successively; not native token-delta streaming.',
    }, null, 2));
    const metrics = [], pngChecks = [], appChecks = [], attentionChecks = [];
    const click = selector => browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const update = () => { for (const stream of streams) stream.write('event: update\ndata: {}\n\n'); };
    const composerPng = () => browser.evaluate(`(async () => {
      const image=document.querySelector('#annotation-image');
      const bytes=await (await fetch(image.src)).arrayBuffer();
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
      return {url:image.src,hash,caption:document.querySelector('#annotation-caption').textContent};
    })()`);
    const fill = (selector, value) => browser.evaluate(`(() => {
      const node=document.querySelector(${JSON.stringify(selector)}); node.value=${JSON.stringify(value)};
      node.dispatchEvent(new Event('input',{bubbles:true})); node.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    async function capture(name) {
      if (/(empty|error|working|attached|replacement-cancel|replacement-accepted|removed|permission-progress|results|history|app-foreground|app-background-complete|app-stopped|app-restarted)$/.test(name)) {
        await browser.evaluate("document.querySelector('#composer').scrollIntoView({block:'end'})");
      }
      const geometry = await browser.evaluate(`(() => {
        const rect=s=>document.querySelector(s)?.getBoundingClientRect().toJSON();
        const status=document.querySelector('#focus-current-message'),style=getComputedStyle(status);
        return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,
          composer:rect('#composer'),actions:rect('.composer-actions'),stop:rect('#stop-current-flow'),
          status:rect('#focus-current-message'),statusText:status.textContent,statusBorder:style.borderWidth,
          questionWrapper:document.querySelector('.human-loop-questions')?{
            border:getComputedStyle(document.querySelector('.human-loop-questions')).borderTopWidth,
            padding:getComputedStyle(document.querySelector('.human-loop-questions')).paddingLeft,
            width:document.querySelector('.human-loop-questions').getBoundingClientRect().width}:null,
          focusVisible:document.activeElement.matches(':focus-visible'),
          focusOutline:getComputedStyle(document.activeElement).outlineWidth,
          captionSize:getComputedStyle(document.querySelector('#annotation-caption')).fontSize,
          preview:rect('#annotation-preview'),caption:rect('#annotation-caption'),remove:rect('#annotation-remove'),
          removeBorder:getComputedStyle(document.querySelector('#annotation-remove')).borderTopWidth,
          progress:document.querySelector('#human-cycle-progress h3')?{
            headingSize:getComputedStyle(document.querySelector('#human-cycle-progress h3')).fontSize,
            explanationSize:getComputedStyle(document.querySelector('#human-cycle-progress .human-loop-muted')).fontSize,
            explanation:document.querySelector('#human-cycle-progress .human-loop-muted').textContent,
            border:getComputedStyle(document.querySelector('#human-cycle-progress')).borderTopWidth}:null,
          messages:rect('#messages'),activeElement:document.activeElement?.outerHTML.slice(0,240),
          cards:[...document.querySelectorAll('.human-loop-questions fieldset')].map(card=>{
            const title=card.querySelector('.human-loop-question-title'),r=card.getBoundingClientRect(),h=title.getBoundingClientRect();
            return {name:title.textContent,labelledBy:card.getAttribute('aria-labelledby'),titleId:title.id,
              inside:h.left>r.left&&h.right<r.right&&h.top>r.top&&h.bottom<r.bottom};
          })};
      })()`);
      assert.ok(geometry.scrollWidth <= geometry.width + 1, `${name}: page horizontal overflow`);
      assert.ok(geometry.composer.height > 0, `${name}: composer missing`);
      assert.equal(geometry.statusBorder, '0px');
      if (/(empty|error|working|attached|replacement-cancel|replacement-accepted|removed|permission-progress|results|history|app-foreground|app-background-complete|app-stopped|app-restarted)$/.test(name)) {
        assert.ok(geometry.composer.bottom <= geometry.height + 1, `${name}: revealed composer clipped`);
      }
      if (/answers-focus$/.test(name)) {
        assert.ok(geometry.focusVisible); assert.ok(parseFloat(geometry.focusOutline) >= 2);
      }
      if (process.env.DAILY_REPLAY_BASELINE !== '1' && geometry.questionWrapper) {
        assert.equal(geometry.questionWrapper.border, '0px');
        assert.equal(geometry.questionWrapper.padding, '0px');
      }
      if (process.env.DAILY_REPLAY_BASELINE !== '1') assert.ok(parseFloat(geometry.captionSize) >= 12);
      if (process.env.DAILY_REPLAY_BASELINE !== '1') {
        assert.equal(geometry.removeBorder, '0px');
        if (geometry.progress) {
          assert.equal(geometry.progress.border, '0px');
          assert.equal(geometry.progress.headingSize, '14px');
          assert.equal(geometry.progress.explanationSize, '12px');
          assert.match(geometry.progress.explanation, /not per-item formal Review or whole-plan completion/);
        }
      }
      if (process.env.DAILY_REPLAY_BASELINE !== '1' && geometry.preview.height > 0) {
        assert.ok(geometry.caption.width >= 100, `${name}: snapshot caption squeezed`);
        assert.ok(geometry.remove.top >= geometry.caption.bottom, `${name}: snapshot controls overlap caption`);
        assert.ok(geometry.remove.right <= geometry.preview.right, `${name}: snapshot control clipped`);
      }
      for (const card of geometry.cards) { assert.ok(card.inside); assert.equal(card.labelledBy, card.titleId); }
      metrics.push({ name, ...geometry });
      if (evidence) {
        await writeFile(join(evidence, `${name}.png`), await browser.screenshot());
        if (geometry.width < 660 && !name.endsWith('-draw')) {
          await writeFile(join(evidence, `${name}-full-page.png`), await browser.screenshot(true));
        }
        await writeFile(join(evidence, 'geometry.json'), JSON.stringify(metrics, null, 2));
      }
    }
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) await t.test(`${width}px ${theme}`, async () => {
      const prefix = `${width}-${theme}`;
      current.design = null; current.messages = []; current.events = []; current.accessRequests = [];
      current.processes = { apps: [], commands: [] };
      Object.assign(current.workflow, { status: 'ready', activeRequestId: null, activeRole: null,
        currentCycle: null, lastHandoff: null, questionInteraction: null, canStop: false });
      preferences.theme = theme; posts.length = 0;
      await browser.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await browser.call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
      await browser.waitFor(`!document.querySelector('#send').disabled && document.body.dataset.theme==='${theme}'`);
      await capture(`${prefix}-01-empty`);
      const prompt = 'Design a daily checklist with a short daily note and saved history.';
      await fill('#message', prompt);
      failNext = true; await click('#send');
      await browser.waitFor("document.querySelector('#notice').textContent.includes('temporarily unavailable')");
      assert.equal(await browser.evaluate("document.querySelector('#message').value"), prompt);
      await capture(`${prefix}-02-error`);
      await click('#send');
      await browser.waitFor("document.querySelector('#focus-current-message').textContent.includes('Working')");
      const requestId = current.workflow.activeRequestId;
      current.messages.push({ id: 'stream', kind: 'assistant', role: 'designer', requestId,
        text: 'I am mapping the daily checklist', timestamp: new Date().toISOString() });
      update(); await browser.waitFor("document.querySelector('#messages').textContent.includes('I am mapping')");
      await capture(`${prefix}-03-working`);
      current.messages.push({ id: 'stream-complete', kind: 'assistant', role: 'designer', requestId,
        text: 'Two choices will keep saved records predictable.', timestamp: new Date().toISOString() });
      update(); await browser.waitFor("document.querySelector('#messages').textContent.includes('Two choices')");
      current.design = { binding, content };
      const source = { role: 'designer', resultId: 'questions', requestId, requestIds: [requestId], cycleId: null,
        design: binding, planDigest: null };
      const resultSummary = 'The daily checklist Design is ready for these two decisions.';
      current.messages.push({ id: 'design-ready', requestId, kind: 'assistant', role: 'designer',
        text: resultSummary, timestamp: new Date().toISOString() });
      current.workflow.lastHandoff = { id: 'design-ready', role: 'designer', kind: 'designer-changed',
        summary: resultSummary, findings: [], verificationLimits: [], designRefs: [] };
      await browser.evaluate("document.querySelector('#message').focus(); document.querySelector('#message').value='Unsent composer draft'; document.querySelector('#message').setSelectionRange(3,3)");
      Object.assign(current.workflow, { status: 'waiting-answer', questionInteraction: {
        resultId: 'questions', source, canAnswer: true, questions: [longQuestion, 'How should daily notes feel?'].map((question, i) => ({
          id: `choice-${i}`, question, context: i ? 'Describe the smallest useful writing experience.' : 'Existing records should remain understandable.',
          whyItMatters: 'Keep daily history predictable.', importance: i ? 'advisory' : 'blocking', source,
          state: 'open', answerRequestId: null, options: [{ id: 'preserve', label: 'Preserve saved records', implication: 'Changes apply only to new days.' }],
          allowFreeform: true,
        })),
      } });
      update(); await browser.waitFor("document.querySelectorAll('.human-loop-questions fieldset').length===2");
      const arrival = await browser.evaluate(`(() => {
        const pane=document.querySelector('#messages').getBoundingClientRect();
        const row=document.querySelector('fieldset[data-question-state=open]');
        const title=row.querySelector('h4').getBoundingClientRect(),choice=row.querySelector('select').getBoundingClientRect();
        return {title: title.top>=pane.top && title.bottom<=pane.bottom, choice:choice.top>=pane.top && choice.bottom<=pane.bottom,
          screen:title.top>=0&&choice.bottom<=innerHeight,focus:document.activeElement.id,caret:document.activeElement.selectionStart,
          duplicates:[...document.querySelectorAll('#messages .conversation-text, #human-workflow p')].filter(n=>n.textContent===${JSON.stringify(resultSummary)}).length};
      })()`);
      assert.equal(arrival.title, true, 'New question heading must be visible without a corrective scroll.');
      assert.equal(arrival.choice, true, 'New question choices must be visible with its heading.');
      assert.equal(arrival.screen, true, 'Question arrival must also reveal the conversation in a stacked viewport.');
      assert.equal(arrival.focus, 'message');
      assert.equal(arrival.caret, 3);
      assert.equal(arrival.duplicates, 1, 'Retain the original summary once, not a second Latest result copy.');
      attentionChecks.push({ width, theme, stage: 'question-arrival', ...arrival });
      await browser.evaluate("document.querySelector('#messages').scrollTop=document.querySelector('#messages').scrollHeight");
      await click('#focus-current-message');
      assert.equal(await browser.evaluate(`(() => {const p=document.querySelector('#messages').getBoundingClientRect(),r=document.querySelector('fieldset[data-question-state=open] h4').getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom})()`), true);
      assert.equal(await browser.evaluate("document.querySelector('.human-loop-questions button[type=submit]').disabled"), true);
      await capture(`${prefix}-04-questions`);
      await fill('.human-loop-questions fieldset:nth-of-type(1) select', 'option:preserve');
      await fill('.human-loop-questions fieldset:nth-of-type(2) select', 'freeform');
      await fill('.human-loop-questions fieldset:nth-of-type(2) textarea', 'One quiet free-text note; no mandatory prompts.');
      await browser.evaluate("document.querySelector('.human-loop-questions textarea:not([hidden])').focus()");
      await browser.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await browser.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await capture(`${prefix}-05-answers-focus`);
      await click('.human-loop-questions button[type=submit]');
      await browser.waitFor("document.querySelector('.human-loop-questions fieldset').dataset.questionState==='answered'");
      assert.equal(posts.filter(post => post.path === '/api/answers').length, 1);
      assert.equal(await browser.evaluate("document.querySelector('.human-loop-question-controls').hidden"), true);
      assert.match(await browser.evaluate("document.querySelector('.human-loop-submitted-answer').textContent"), /Preserve saved records/);
      assert.equal(await browser.evaluate("document.querySelector('.human-loop-questions button[type=submit]').hidden"), true);
      attentionChecks.push({ width, theme, stage: 'answered', exactSubmittedAnswerShown: true, editableControlsHidden: true });
      await capture(`${prefix}-05-submitted-readonly`);
      for (const category of ['user-story', 'ui', 'workflows']) {
        const selector = `[data-artifact-group="${category}"]`;
        if (!await browser.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) continue;
        await click(selector);
        assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-pressed')`), 'true');
        await click('[data-artifact-tab]');
        await browser.waitFor("document.querySelector('.source-artifact')");
        await browser.waitFor("document.querySelector('.source-artifact svg')?.children.length || document.querySelector('.source-artifact iframe')?.contentDocument?.body?.children.length");
        await capture(`${prefix}-06-${category}`);
      }
      await click('[data-artifact-group="user-story"]');
      await browser.waitFor("document.querySelector('.source-artifact iframe') && !document.querySelector('.annotation-view-toggle').disabled");
      const note = await browser.evaluate("document.querySelector('[data-artifact-note]')?.getAttribute('data-artifact-note')");
      if (note) {
        await click(`[data-artifact-note="${note}"]`); await browser.waitFor("document.querySelector('[data-note-primary]')");
        await capture(`${prefix}-07-notes`); await click('[data-note-primary]');
      }
      await click('.raw-toggle');
      assert.equal(await browser.evaluate("document.querySelector('.annotation-view-toggle').disabled"), true);
      await capture(`${prefix}-08-raw`);
      await click('.raw-toggle'); await browser.waitFor("!document.querySelector('.annotation-view-toggle').disabled");
      await click('[data-artifact-zoom="actual"]');
      const pan = await browser.evaluate(`(() => {
        const view=document.querySelector('[data-artifact-viewport]');
        view.scrollLeft=view.scrollWidth-view.clientWidth; view.scrollTop=view.scrollHeight-view.clientHeight;
        return {left:view.scrollLeft,top:view.scrollTop,width:view.clientWidth,scrollWidth:view.scrollWidth};
      })()`);
      if (width < 660) assert.ok(pan.left > 0, 'The narrow native-size artifact must be horizontally pannable.');
      await capture(`${prefix}-09-native-pan`);
      await click('[data-artifact-zoom="in"]'); await click('[data-artifact-zoom="out"]'); await click('[data-artifact-zoom="fit"]');
      await browser.evaluate("document.querySelector('.source-artifact').scrollIntoView({block:'center'});document.querySelector('#canvas-scroll').scrollLeft=0");
      await capture(`${prefix}-09-fit`);
      const noSend = posts.length;
      await click('.annotation-view-toggle');
      await browser.waitFor("document.querySelector('.annotation-editor').open && !document.querySelector('[data-annotation-action=attach]').disabled");
      const point = await browser.evaluate("(()=>{const r=document.querySelector('.annotation-editor-ink').getBoundingClientRect();return {x:r.left+r.width*.3,y:r.top+Math.min(80,r.height*.3)}})()");
      await browser.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await browser.call('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: point.x + 35, y: point.y + 20 });
      await browser.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: point.x + 35, y: point.y + 20 });
      await browser.waitFor("!document.querySelector('[data-annotation-action=clear]').disabled");
      await capture(`${prefix}-10-draw`);
      await click('[data-annotation-action=close]');
      assert.equal(posts.length, noSend);
      await click('.annotation-view-toggle');
      await browser.waitFor("document.querySelector('.annotation-editor').open && !document.querySelector('[data-annotation-action=clear]').disabled");
      await click('[data-annotation-action=attach]');
      await browser.waitFor("!document.querySelector('#annotation-preview').hidden && !document.querySelector('.annotation-editor').open");
      assert.equal(posts.length, noSend, 'Attach is local only');
      await capture(`${prefix}-11-attached`);
      const originalPng = await composerPng();
      assert.match(originalPng.caption, /Not sent/);
      assert.ok(originalPng.caption.includes(binding.revisionId));
      assert.equal(await browser.evaluate("document.querySelector('.annotation-view-toggle').textContent"), 'Annotate',
        'Successful Attach finishes the annotation; the next action starts a new capture.');
      assert.equal(await browser.evaluate("document.querySelector('.annotation-editor-base').hasAttribute('src')"), false);
      await browser.evaluate("document.querySelector('.source-artifact').scrollIntoView({block:'center'})");
      await click('.annotation-view-toggle');
      await browser.waitFor("document.querySelector('.annotation-editor').open && !document.querySelector('[data-annotation-action=attach]').disabled");
      assert.equal(await browser.evaluate("document.querySelector('[data-annotation-action=clear]').disabled"), true,
        'The next capture must start without the completed annotation strokes.');
      const editPoint = await browser.evaluate("(()=>{const r=document.querySelector('.annotation-editor-ink').getBoundingClientRect();return {x:r.left+r.width*.6,y:r.top+r.height*.55}})()");
      await browser.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...editPoint });
      await browser.call('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: editPoint.x + 25, y: editPoint.y + 15 });
      await browser.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: editPoint.x + 25, y: editPoint.y + 15 });
      assert.deepEqual(await composerPng(), originalPng, 'Drawing a new annotation must not mutate the prior composer PNG.');
      await capture(`${prefix}-11-new-capture-draw`);
      await browser.evaluate(`(() => {
        const original=HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob=function(callback) {
          HTMLCanvasElement.prototype.toBlob=original;
          queueMicrotask(()=>callback(null));
        };
      })()`);
      await click('[data-annotation-action=attach]');
      await browser.waitFor("document.querySelector('.annotation-editor-status').textContent.includes('could not be encoded')");
      assert.equal(await browser.evaluate("document.querySelector('.annotation-editor').open"), true);
      assert.equal(await browser.evaluate("document.querySelector('[data-annotation-action=clear]').disabled"), false);
      assert.deepEqual(await composerPng(), originalPng, 'Failed replacement must preserve the prior export and its source.');
      await capture(`${prefix}-11-replacement-failed`);
      await click('[data-annotation-action=close]');
      assert.deepEqual(await composerPng(), originalPng, 'Cancel before successful Attach preserves the existing export.');
      assert.equal(await browser.evaluate("document.querySelector('.annotation-view-toggle').textContent"), 'Resume sketch');
      await capture(`${prefix}-11-replacement-cancel`);
      await click('.annotation-view-toggle');
      await browser.waitFor("document.querySelector('.annotation-editor').open && !document.querySelector('[data-annotation-action=attach]').disabled");
      assert.equal(await browser.evaluate("document.querySelector('[data-annotation-action=clear]').disabled"), false,
        'Failure and cancellation retain the unfinished new draft for retry.');
      await click('[data-annotation-action=attach]');
      await browser.waitFor(`!document.querySelector('.annotation-editor').open && document.querySelector('#annotation-image').src!==${JSON.stringify(originalPng.url)}`);
      const updatedPng = await composerPng();
      assert.notEqual(updatedPng.hash, originalPng.hash, 'Successful retry exports the independently drawn new annotation.');
      assert.equal(updatedPng.caption, originalPng.caption, 'Source provenance and not-sent state remain unchanged.');
      assert.equal(await browser.evaluate("document.querySelector('.annotation-view-toggle').textContent"), 'Annotate');
      assert.equal(posts.length, noSend, 'Capture, failed replacement and successful retry remain local only.');
      await browser.evaluate("document.querySelector('#message').focus()");
      await browser.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 });
      await browser.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      assert.equal(await browser.evaluate("document.activeElement.id"), 'annotation-remove');
      assert.equal(await browser.evaluate("document.activeElement.matches(':focus-visible')"), true);
      await capture(`${prefix}-11-replacement-accepted`);
      current.messages.push({ id: 'implement', kind: 'user', requestId: 'implement', text: 'Implement the reviewed daily checklist and note.',
        timestamp: new Date().toISOString(), queueState: 'active' });
      Object.assign(current.workflow, { status: 'waiting-permission', activeRequestId: 'implement', activeRole: 'implementer',
        canStop: true, questionInteraction: null, currentCycle: { id: 'cycle', originRequestId: 'implement', phase: 'implementing',
          completed: 0, total: 1, plan: null, tasks: [{ id: 'daily', title: 'Persist daily checklist and note', status: 'working' }] } });
      const exactPermission = 'Replay exact command details:\n' + 'node --test daily-record.test.mjs\n'.repeat(100);
      current.accessRequests = [{ id: 'verify', title: 'Run the daily-record checks?', description: exactPermission,
        scopes: ['Purpose: Verify daily records', 'Command: node', 'Working directory: prototype', 'Arguments: ["--test","daily-record.test.mjs"]'],
        canApproveForSession: true, canApproveAll: true }];
      update(); await browser.waitFor("document.querySelector('[data-access-decision=once]')");
      await capture(`${prefix}-12-permission-progress`);
      await click('.access-request-details > summary');
      assert.equal(await browser.evaluate("document.querySelector('.access-request-details > pre').textContent"), exactPermission);
      await browser.evaluate("document.querySelector('.access-request-context').scrollTop=900");
      const visibleDecision = await browser.evaluate(`(() => {
        const p=document.querySelector('#access-approval').getBoundingClientRect();
        const buttons=[...document.querySelectorAll('.access-card:not([hidden]) [data-access-decision]')];
        return {pane:p.toJSON(),context:document.querySelector('.access-request-context').getBoundingClientRect().toJSON(),
          buttons:buttons.map(n=>n.getBoundingClientRect().toJSON()),visible:buttons.every(n=>{
          const r=n.getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom;
        })};
      })()`);
      assert.equal(visibleDecision.visible, true, `Decisions stay visible while exact command details scroll: ${JSON.stringify(visibleDecision)}`);
      attentionChecks.push({ width, theme, stage: 'expanded-permission', ...visibleDecision, exactDetailsRetained: true });
      await capture(`${prefix}-12-permission-exact`);
      await browser.evaluate("globalThis.retainedPermission=document.querySelector('.access-request-details');globalThis.retainedPermissionTop=document.querySelector('.access-request-context').scrollTop;document.querySelector('.access-request-details > summary').focus({preventScroll:true})");
      current.workflow.status = 'stopping';
      update(); await browser.waitFor("document.querySelector('#focus-current-message').textContent.includes('Stopping')");
      assert.equal(await browser.evaluate("document.querySelector('.access-request-details')===globalThis.retainedPermission && document.querySelector('.access-request-details').open && document.querySelector('.access-request-context').scrollTop===globalThis.retainedPermissionTop && document.activeElement===document.querySelector('.access-request-details > summary')"), true,
        'A workflow-only update must not reset permission reading position, disclosure or focus.');
      current.workflow.status = 'waiting-permission';
      current.accessRequests.push({ ...current.accessRequests[0], id: 'verify-next', title: 'Second independent permission' });
      update(); await browser.waitFor("document.querySelector('.access-request-picker select')");
      assert.equal(await browser.evaluate("document.querySelector('.access-request-details')===globalThis.retainedPermission && document.querySelector('.access-request-context').scrollTop===globalThis.retainedPermissionTop"), true,
        'A different pending request must not discard the currently inspected request.');
      await fill('.access-request-picker select', 'verify-next');
      assert.equal(await browser.evaluate("document.querySelector('.access-card:not([hidden]) .access-request-context').scrollTop"), 0);
      assert.equal(await browser.evaluate("document.querySelector('#access-approval').scrollTop"), 0);
      await capture(`${prefix}-12-permission-choice`);
      await click('[data-request-id=verify-next][data-access-decision=denied]');
      await browser.waitFor("document.querySelectorAll('#access-requests .access-card').length===1");
      await click('[data-request-id=verify][data-access-decision=once]');
      await browser.waitFor("!document.querySelector('[data-access-decision=once]')");
      await browser.evaluate("document.querySelector('#human-cycle-progress').scrollIntoView({block:'center'})");
      await capture(`${prefix}-12-progress-detail`);
      // These are supplied snapshot states, not real tools/processes or an
      // assertion that the renderer decides terminal admission.
      current.processes.apps = [{ id: 'replay-preview-1', command: 'Generated daily preview (fixture)', status: 'running', canStop: false }];
      current.workflow.status = 'working';
      current.messages.push({ id: 'foreground-pending', kind: 'assistant', role: 'implementer', requestId: 'implement',
        text: 'Replay state: the preview child is alive while a foreground shell tool is still pending.',
        timestamp: new Date().toISOString() });
      update();
      await browser.waitFor("document.querySelector('#focus-current-message').textContent.includes('Working') && document.querySelector('#apps').textContent.includes('running')");
      await click('#open-diagnostics');
      assert.equal(await browser.evaluate("document.querySelector('#stop-current-flow').hidden"), false);
      await capture(`${prefix}-12-app-foreground`);
      appChecks.push({ width, theme, phase: 'foreground tool pending (synthetic input)', app: 'running',
        observedWorkflow: 'Working', terminalAdmission: 'not exercised' });
      current.workflow.currentCycle.completed = 1; current.workflow.currentCycle.phase = 'reviewed';
      current.workflow.currentCycle.tasks[0].status = 'completed';
      Object.assign(current.workflow, { status: 'ready', canStop: false, activeRole: null, activeRequestId: null,
        lastHandoff: { id: 'review', role: 'reviewer',
        kind: 'review-result', summary: 'Daily records keep their checklist and note.',
        findings: [{ summary: 'Date-boundary behavior needs manual verification.', consequence: 'A timezone change may select a different day.',
          evidenceRefs: ['Replay finding, not an executed product test.'], designRefs: [] }],
        verificationLimits: ['Deterministic visual replay; no native implementation or SDK execution.'] } });
      current.messages.push({ id: 'background-complete', kind: 'assistant', role: 'implementer', requestId: 'implement',
        text: 'Replay state: the background-start command tool completed and the role finished; the preview child remains alive.',
        timestamp: new Date().toISOString() });
      current.messages.push({ id: 'review', kind: 'assistant', role: 'reviewer', requestId: 'implement',
        text: 'Daily records keep their checklist and note. Date-boundary behavior needs manual verification.', timestamp: new Date().toISOString() });
      current.events.push({ sequence: 1, type: 'human.role', source: 'system', summary: 'Review result',
        timestamp: new Date().toISOString(), data: { requestId: 'implement', role: 'reviewer' } });
      update(); await browser.waitFor("document.querySelector('#messages').textContent.includes('Date-boundary behavior')");
      await browser.waitFor("document.querySelector('.human-loop-finding')?.textContent.includes('Consequence:')");
      await click('#focus-current-message');
      await capture(`${prefix}-13-results`);
      assert.equal(await browser.evaluate("document.querySelector('#stop-current-flow').hidden"), true);
      assert.match(await browser.evaluate("document.querySelector('#apps').textContent"), /running/);
      assert.match(await browser.evaluate("document.querySelector('#focus-current-message').textContent"), /Ready/);
      await capture(`${prefix}-13-app-background-complete`);
      appChecks.push({ width, theme, phase: 'background-start tool completed and role completed (synthetic input)',
        app: 'running', observedWorkflow: 'Ready', activeRole: current.workflow.activeRole, terminalAdmission: 'not exercised' });
      current.processes.apps[0].status = 'stopped'; update();
      await browser.waitFor("document.querySelector('#apps').textContent.includes('stopped')");
      await capture(`${prefix}-13-app-stopped`);
      current.processes.apps = [{ id: 'replay-preview-2', command: 'Generated daily preview restart 2 (fixture)', status: 'running', canStop: false }];
      update();
      await browser.waitFor("document.querySelector('#apps').textContent.includes('restart 2 (fixture): running')");
      assert.match(await browser.evaluate("document.querySelector('#focus-current-message').textContent"), /Ready/);
      await capture(`${prefix}-13-app-restarted`);
      appChecks.push({ width, theme, phase: 'app stopped then new background child supplied (synthetic input)',
        app: 'running', observedWorkflow: 'Ready', terminalAdmission: 'not exercised', actualAppOrShellProcessesCreated: 0 });
      await click('#open-diagnostics');
      await browser.evaluate("document.querySelector('#messages').scrollTop=0");
      await capture(`${prefix}-14-history`);
      await click('#focus-current-message');
      assert.deepEqual(posts.filter(post => post.path.startsWith('/api/access/')), [
        { path: '/api/access/verify-next', data: { decision: 'denied' } },
        { path: '/api/access/verify', data: { decision: 'once' } },
      ]);
      assert.deepEqual(content.artifacts.slice(0, provenance.length).map(({ id, format, source }) => ({
        id, format, sha256: createHash('sha256').update(source).digest('hex'),
      })), provenance);
      assert.deepEqual(browser.exceptions, []);
      const beforeRemoval = posts.length;
      await click('#annotation-remove');
      assert.equal(await browser.evaluate("document.querySelector('#annotation-preview').hidden"), true);
      assert.equal(await browser.evaluate("document.querySelector('.annotation-view-toggle').textContent"), 'Annotate',
        'Removing the exported PNG must not resurrect a completed draft.');
      assert.equal(posts.length, beforeRemoval);
      await capture(`${prefix}-15-removed`);
      pngChecks.push({ width, theme, originalSha256: originalPng.hash, replacementSha256: updatedPng.hash,
        sourceCaption: updatedPng.caption, failedReplacementPreservedOriginal: true, retryPreservedUnfinishedStrokes: true,
        nextCaptureStartedClean: true, removalResurrectedDraft: false, annotationPosts: 0 });
      if (evidence) await writeFile(join(evidence, 'png-checks.json'), JSON.stringify(pngChecks, null, 2));
      if (evidence) await writeFile(join(evidence, 'app-state-checks.json'), JSON.stringify(appChecks, null, 2));
      if (evidence) await writeFile(join(evidence, 'attention-checks.json'), JSON.stringify(attentionChecks, null, 2));
    });
  });
