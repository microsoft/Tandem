import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import test from 'node:test';
import { browserAvailable, openFixtureBrowser } from './helpers/browser-fixture.mjs';
import { multiFormatDesign } from './fixtures/multi-format.mjs';
import { policyHash } from '../runtime-src/domain/workflow/policy.ts';

const publicRoot = resolve(import.meta.dirname, '../public');

test('populated shell controls have distinct navigation hierarchy and compact accessible states',
  { skip: !browserAvailable, timeout: 120_000 }, async t => {
    const content = multiFormatDesign();
    content.artifacts[0].category = 'user-story';
    content.artifacts[1].category = 'ui';
    content.artifacts[2].category = 'ui';
    const current = {
      schemaVersion: 'human-loop-snapshot-view/v1', streamId: 'visual-refinement',
      installation: { status: 'ready', canStart: false, canReopen: false },
      design: { binding: { revisionId: 'visual-design', digest: policyHash(content) }, content },
      workflow: { schemaVersion: 'human-loop-view/v1', status: 'ready', reason: null,
        activeRequestId: null, activeRole: null, workspacePath: 'Coffee pickup', currentCycle: null,
        lastHandoff: { id: 'design-ready', role: 'designer', kind: 'designer-changed',
          summary: 'The pickup Design is ready to discuss.', findings: [], verificationLimits: [] },
        queue: [], canStop: false, canSend: true, questionInteraction: null },
      messages: [
        { id: 'request', kind: 'user', requestId: 'request', text: 'Help customers order coffee and collect it without waiting in line.',
          timestamp: '2026-09-20T08:00:00Z', queueState: 'completed' },
        { id: 'response', kind: 'assistant', role: 'designer', requestId: 'request',
          text: 'The Design connects ordering, checkout and pickup. Review the screens and annotate anything you would like to change.',
          timestamp: '2026-09-20T08:00:01Z' },
      ],
      events: [{ sequence: 1, type: 'human.role', source: 'system', summary: 'Design ready',
        timestamp: '2026-09-20T08:00:01Z', data: { requestId: 'request', role: 'designer' } }],
      accessRequests: [], processes: { apps: [], commands: [] },
    };
    const posts = [], preferences = { theme: 'light', fontSize: 'normal' };
    const server = createServer(async (request, response) => {
      try {
        const path = new URL(request.url, 'http://127.0.0.1').pathname;
        if (request.method !== 'GET') {
          posts.push(path); response.writeHead(405); response.end(); return;
        }
        if (path === '/api/events') {
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          response.write('event: update\ndata: {}\n\n'); return;
        }
        const json = path === '/api/snapshot' ? current : path === '/api/settings'
          ? { preferences, model: { models: [], actual: null, canChange: false, reason: 'No model changes in this fixture.' } } : null;
        if (json) {
          response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(json)); return;
        }
        const file = resolve(publicRoot, path === '/' ? 'human-loop.html' : path.slice(1));
        if (!file.startsWith(publicRoot + sep)) throw new Error('Outside fixture assets.');
        response.writeHead(200, { 'content-type': {
          '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
          '.png': 'image/png', '.jpg': 'image/jpeg',
        }[extname(file)] ?? 'application/octet-stream' });
        response.end(await readFile(file));
      } catch (error) { response.writeHead(500); response.end(error.message); }
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const scratch = resolve(`.shell-visual-browser-${process.pid}`);
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
    const evidence = process.env.TANDEM_BROWSER_ARTIFACTS;
    if (evidence) await mkdir(evidence, { recursive: true });
    const phase = process.env.TANDEM_VISUAL_BASELINE === '1' ? 'before' : 'after';
    const metrics = [];
    const activationGeometry = () => browser.evaluate(`(() => {
      const rect=selector=>document.querySelector(selector)?.getBoundingClientRect().toJSON();
      const image=document.querySelector('.annotation-editor-base'),ink=document.querySelector('.annotation-editor-ink');
      return {status:document.querySelector('.annotation-editor-status')?.textContent,
        scrollTop:document.querySelector('#canvas-scroll').scrollTop,
        surface:rect('.source-artifact iframe'),editor:rect('.annotation-editor'),
        bitmap:rect('.annotation-editor-base'),ink:rect('.annotation-editor-ink'),
        bitmapSize:{width:image?.naturalWidth,height:image?.naturalHeight},
        inkSize:{width:ink?.width,height:ink?.height},
        toolbar:rect('.annotation-editor-toolbar')};
    })()`);
    const editorReady = () => browser.waitFor(`document.querySelector('.annotation-editor').open
      && document.querySelector('.annotation-editor-base').naturalWidth > 0
      && !document.querySelector('[data-annotation-action="attach"]').disabled`);
    function assertEditorGeometry(geometry, width, height) {
      assert.ok(geometry.editor.left >= 0 && geometry.editor.right <= width);
      assert.ok(geometry.editor.top >= 0 && geometry.editor.bottom <= height);
      for (const key of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(geometry.bitmap[key] - geometry.ink[key]) < .1, JSON.stringify(geometry));
      }
      assert.deepEqual(geometry.inkSize, geometry.bitmapSize);
      assert.ok(Math.abs(geometry.bitmap.width / geometry.bitmap.height - geometry.bitmapSize.width / geometry.bitmapSize.height) < .01);
    }
    const click = selector => browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    async function capture(name, fullPage = true) {
      if (evidence) await writeFile(join(evidence, `${phase}-${name}.png`), await browser.screenshot(fullPage));
    }
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) await t.test(`${width}px ${theme}`, async () => {
      preferences.theme = theme;
      await browser.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await browser.call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
      await browser.waitFor("document.querySelector('[data-artifact-group=\"ui\"]') && document.body.dataset.theme");
      await click('[data-artifact-group="ui"]');
      await browser.waitFor("document.querySelector('.source-artifact iframe') && !document.querySelector('.annotation-view-toggle').disabled");
      await browser.evaluate('document.fonts.ready');
      await capture(`${width}-${theme}`);
      const result = await browser.evaluate(`(() => {
        const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
        const ctx=canvas.getContext('2d',{willReadFrequently:true});
        const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);
          return [...ctx.getImageData(0,0,1,1).data].map((v,i)=>i===3?v/255:v);};
        function background(n){
          const c=rgb(getComputedStyle(n).backgroundColor);
          if(c[3]===1)return c;
          const p=n.parentElement?background(n.parentElement):[255,255,255,1];
          return [...c.slice(0,3).map((v,i)=>v*c[3]+p[i]*(1-c[3])),1];
        }
        const luminance=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;})
          .reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
        const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
        const selectors = { category:'[data-artifact-group="ui"]', artifact:'[data-artifact-tab="checkout"]',
          annotate:'.annotation-view-toggle', raw:'.raw-toggle', zoom:'[data-artifact-zoom="fit"]' };
        const controls=Object.fromEntries(Object.entries(selectors).map(([name,selector])=>{
          const n=document.querySelector(selector),s=getComputedStyle(n),r=n.getBoundingClientRect();
          return [name,{height:r.height,width:r.width,font:parseFloat(s.fontSize),radius:s.borderRadius,
            background:s.backgroundColor,color:s.color,weight:s.fontWeight,shadow:s.boxShadow,
            contrast:contrast(rgb(s.color),background(n)),
            selected:n.getAttribute('aria-pressed'),disabled:n.disabled}];
        }));
        const toolbar=document.querySelector('.perspective-toolbar').getBoundingClientRect();
        const group=document.querySelector('[aria-label="Artifact zoom"]').getBoundingClientRect();
        const hidden=[...document.querySelectorAll('[hidden]')].filter(n=>getComputedStyle(n).display!=='none').length;
        return {controls,toolbarHeight:toolbar.height,zoomWidth:group.width,hidden,
          overflow:document.documentElement.scrollWidth>innerWidth,
          content:document.querySelector('.source-artifact iframe').contentDocument.body.textContent,
          sourceColor:document.querySelector('.source-artifact iframe').contentWindow.getComputedStyle(
            document.querySelector('.source-artifact iframe').contentDocument.querySelector('.tile')).backgroundColor,
          theme:document.body.dataset.theme};
      })()`);
      metrics.push({ width, theme, ...result });
      assert.equal(result.theme, theme);
      assert.match(result.content, /Oat flat white/);
      assert.equal(result.sourceColor, 'rgb(224, 48, 48)');
      assert.equal(result.overflow, false);
      assert.equal(result.hidden, 0);
      assert.equal(result.controls.category.selected, 'true');
      assert.equal(result.controls.artifact.selected, 'true');
      if (phase === 'before') return;
      if (phase === 'after') {
        assert.notEqual(result.controls.category.background, result.controls.artifact.background);
        assert.equal(result.controls.annotate.height, result.controls.raw.height);
        assert.equal(result.controls.annotate.radius, result.controls.raw.radius);
        assert.equal(result.controls.annotate.weight, result.controls.raw.weight);
        for (const control of Object.values(result.controls)) {
          assert.ok(control.height >= 28 && control.height <= 36, JSON.stringify(result));
          assert.ok(control.font >= 13, JSON.stringify(result));
          assert.ok(control.contrast >= 4.5, JSON.stringify(result));
        }
        assert.ok(result.toolbarHeight <= 44, JSON.stringify(result));
        assert.ok(result.zoomWidth < 320, JSON.stringify(result));
      }
      const hoverPoint = await browser.evaluate(`(() => {
        const r=document.querySelector('.annotation-view-toggle').getBoundingClientRect();
        return {x:r.x+r.width/2,y:r.y+r.height/2};
      })()`);
      await browser.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hoverPoint });
      const hoverBackground = await browser.evaluate("getComputedStyle(document.querySelector('.annotation-view-toggle')).backgroundColor");
      assert.notEqual(hoverBackground, result.controls.annotate.background);
      metrics.at(-1).hoverBackground = hoverBackground;
      await browser.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
      await browser.evaluate("document.querySelector('.annotation-view-toggle').focus()");
      await browser.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await browser.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      assert.equal(await browser.evaluate("document.activeElement.classList.contains('raw-toggle')"), true);
      const focus = await browser.evaluate(`(() => {
        const s=getComputedStyle(document.activeElement);
        const luminance=color=>color.match(/[\\d.]+/g).slice(0,3).map(v=>{
          v=Number(v)/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
        }).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        const a=luminance(s.outlineColor),b=luminance(s.backgroundColor);
        return {style:s.outlineStyle,width:s.outlineWidth,color:s.outlineColor,
          contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
      })()`);
      assert.equal(focus.style, 'solid'); assert.equal(focus.width, '2px');
      assert.ok(focus.contrast >= 3, JSON.stringify(focus));
      await capture(`focus-${width}-${theme}`);
      await browser.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
      await browser.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      assert.equal(await browser.evaluate("document.querySelector('.raw-toggle').getAttribute('aria-expanded')"), 'true');
      await browser.call('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      await browser.call('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
      assert.equal(await browser.evaluate("document.querySelector('.raw-toggle').getAttribute('aria-expanded')"), 'false');
      await click('[data-artifact-zoom="in"]');
      const zoom = await browser.evaluate("document.querySelector('.source-artifact').getViewState()");
      await click('[data-artifact-zoom="fit"]');
      assert.notDeepEqual(await browser.evaluate("document.querySelector('.source-artifact').getViewState()"), zoom);
      await browser.evaluate(`(async()=>{document.querySelector('.source-artifact iframe').scrollIntoView({block:'center'});
        await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));})()`);
      const geometry = { before: await activationGeometry() };
      await click('.annotation-view-toggle');
      await editorReady();
      await browser.evaluate("new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))");
      geometry.activated = await activationGeometry();
      metrics.at(-1).activationGeometry = geometry;
      metrics.at(-1).cleanActivation = true;
      if (evidence) await writeFile(join(evidence, `activation-${width}-${theme}.json`), JSON.stringify(geometry, null, 2));
      assertEditorGeometry(geometry.activated, width, 1000);
      assert.equal(await browser.evaluate("document.querySelector('[data-annotation-action=\"clear\"]').disabled"), true);
      assert.equal(await browser.evaluate("document.activeElement.dataset.annotationAction"), 'close');
      await browser.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await browser.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      assert.equal(await browser.evaluate("document.activeElement.dataset.annotationAction"), 'cancel');
      await browser.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await browser.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      assert.equal(await browser.evaluate("document.activeElement.dataset.annotationAction"), 'capture-new', 'Keyboard navigation skips disabled Clear.');
      assert.equal(await browser.evaluate("getComputedStyle(document.activeElement).outlineWidth"), '2px');
      await capture(`editor-empty-${width}-${theme}`, false);
      const point = await browser.evaluate(`(() => {
        const n=document.querySelector('.annotation-editor-ink');
        const r=n.getBoundingClientRect(); return {x:r.x+30,y:r.y+30};
      })()`);
      await browser.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await browser.call('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: point.x + 40, y: point.y + 25 });
      await browser.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: point.x + 40, y: point.y + 25 });
      await browser.waitFor("!document.querySelector('[data-annotation-action=\"clear\"]').disabled");
      geometry.drawn = await activationGeometry();
      assertEditorGeometry(geometry.drawn, width, 1000);
      const inkPixels = await browser.evaluate(`(() => {
        const canvas=document.querySelector('.annotation-editor-ink');
        return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data
          .filter((value,index)=>index%4===3&&value>0).length;
      })()`);
      assert.ok(inkPixels > 30, 'The annotation evidence must contain a real drawn stroke.');
      metrics.at(-1).annotationInkPixels = inkPixels;
      const retained = await browser.evaluate(`({
        ink:document.querySelector('.annotation-editor-ink').toDataURL(),
        bitmap:document.querySelector('.annotation-editor-base').src
      })`);
      await browser.call('Emulation.setDeviceMetricsOverride', { width: 320, height: 700, deviceScaleFactor: 1, mobile: false });
      await browser.evaluate("new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))");
      geometry.resized = await activationGeometry();
      assertEditorGeometry(geometry.resized, 320, 700);
      assert.deepEqual(geometry.resized.inkSize, geometry.drawn.inkSize);
      assert.equal(await browser.evaluate("document.querySelector('.annotation-editor-ink').toDataURL()"), retained.ink);
      await capture(`editor-320-${theme}`, false);
      await click('[data-annotation-action="capture-new"]');
      assert.equal(await browser.evaluate("document.querySelector('.annotation-editor-confirmation').hidden"), false);
      assertEditorGeometry(await activationGeometry(), 320, 700);
      await capture(`editor-confirmation-320-${theme}`, false);
      await click('[data-annotation-action="keep"]');
      assert.equal(await browser.evaluate("document.querySelector('.annotation-editor-ink').toDataURL()"), retained.ink);
      await browser.call('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false });
      await browser.evaluate("new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))");
      await click('[data-annotation-action="close"]');
      await click('[data-artifact-zoom="in"]');
      await click('.raw-toggle');
      await click('.annotation-view-toggle');
      await editorReady();
      assert.equal(await browser.evaluate("document.querySelector('.annotation-editor-ink').toDataURL()"), retained.ink);
      assert.equal(await browser.evaluate("document.querySelector('.annotation-editor-base').src"), retained.bitmap);
      assert.equal(await browser.evaluate("document.querySelector('#annotation-tools').hidden"), true);
      assert.equal(await browser.evaluate("document.querySelector('.raw-toggle').getAttribute('aria-expanded')"), 'true');
      geometry.resumedFromRaw = await activationGeometry();
      assertEditorGeometry(geometry.resumedFromRaw, width, 1000);
      await capture(`annotation-${width}-${theme}`, false);
      await click('[data-annotation-action="attach"]');
      await browser.waitFor("!document.querySelector('.annotation-editor').open && !document.querySelector('#annotation-preview').hidden && document.querySelector('#annotation-image').naturalWidth > 0");
      assert.deepEqual(await browser.evaluate("[document.querySelector('.annotation-preview-status').textContent, document.querySelector('.annotation-preview-provenance').textContent]"),
        ['Not sent. ', 'PNG snapshot - checkout, revision visual-design.']);
      await click('.raw-toggle');
      await click('[data-artifact-zoom="fit"]');
      if (evidence) await writeFile(join(evidence, `activation-${width}-${theme}.json`), JSON.stringify(geometry, null, 2));
      await capture(`attached-${width}-${theme}`);
      await click('#annotation-remove');
      await click('[data-artifact-tab="pickup-plan"]');
      await browser.waitFor("document.querySelector('.source-artifact[data-artifact-id=\"pickup-plan\"]') && !document.querySelector('.annotation-view-toggle').disabled");
      await click('[data-artifact-tab="checkout"]');
      await browser.waitFor("document.querySelector('.source-artifact iframe') && !document.querySelector('.annotation-view-toggle').disabled");
      await click('#canvas-settings summary');
      assert.equal(await browser.evaluate("document.querySelector('#apply-model').disabled"), true);
      const disabled = await browser.evaluate(`(() => {
        const n=document.querySelector('#apply-model'),s=getComputedStyle(n),r=n.getBoundingClientRect();
        return {background:s.backgroundColor,opacity:s.opacity,cursor:s.cursor,x:r.x+r.width/2,y:r.y+r.height/2};
      })()`);
      await browser.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: disabled.x, y: disabled.y });
      assert.equal(await browser.evaluate("getComputedStyle(document.querySelector('#apply-model')).backgroundColor"), disabled.background);
      assert.equal(disabled.cursor, 'not-allowed');
      metrics.at(-1).disabled = disabled;
      await click('#apply-model');
      assert.equal(await browser.evaluate("document.querySelector('#apply-model').focus();document.activeElement.id==='apply-model'"), false);
      await capture(`settings-${width}-${theme}`);
      await click('#canvas-settings summary');
      metrics.at(-1).keyboardFocus = focus;
      metrics.at(-1).interactionChecks = ['keyboard-tab-enter-space', 'zoom-in', 'fit', 'clean-snapshot-activation', 'draw', 'bitmap-coordinate-resize',
        'bound-local-png-preview', 'resume-unchanged-through-raw-and-zoom',
        'artifact-switch-and-return', 'settings-disabled-model'];
    });
    if (phase === 'after') {
      await t.test('offscreen capture stays unavailable until the user navigates to the artifact', async () => {
      await browser.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 440, deviceScaleFactor: 1, mobile: false });
      await browser.call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
      await browser.waitFor("document.querySelector('[data-artifact-group=\"ui\"]')");
      await click('[data-artifact-group="ui"]');
      await browser.waitFor("document.querySelector('.source-artifact iframe') && !document.querySelector('.annotation-view-toggle').disabled");
      await browser.evaluate("new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))");
      const below = { before: await activationGeometry() };
      assert.ok(below.before.surface.top >= 440, 'This fixture must begin with the artifact below the viewport.');
      const point = await browser.evaluate(`(() => {
        const n=document.querySelector('.annotation-view-toggle'),r=n.getBoundingClientRect();
        const p={x:r.x+r.width/2,y:r.y+r.height/2};
        if(!n.contains(document.elementFromPoint(p.x,p.y)))throw new Error('Annotate is obscured');
        return p;
      })()`);
      await browser.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await browser.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
      below.activated = await activationGeometry();
      if (evidence) await writeFile(join(evidence, 'activation-below-viewport.json'), JSON.stringify(below, null, 2));
      await browser.waitFor("document.querySelector('.annotation-editor').open && document.querySelector('.annotation-editor-status').textContent.includes('Bring the supported artifact into view')");
      assert.equal(await browser.evaluate("document.querySelector('.annotation-editor-base').naturalWidth"), 0);
      assert.equal(await browser.evaluate("document.querySelector('[data-annotation-action=\"attach\"]').disabled"), true);
      assert.equal(await browser.evaluate("document.querySelector('#annotation-preview').hidden"), true);
      await capture('below-viewport-unavailable', false);
      await click('[data-annotation-action="close"]');
      await browser.evaluate(`(async()=>{
        document.querySelector('.source-artifact iframe').scrollIntoView({block:'center'});
        await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
      })()`);
      await click('.annotation-view-toggle');
      await editorReady();
      below.afterExplicitNavigation = await activationGeometry();
      assertEditorGeometry(below.afterExplicitNavigation, 1440, 440);
      if (evidence) await writeFile(join(evidence, 'activation-below-viewport.json'), JSON.stringify(below, null, 2));
      await capture('below-viewport-activation', false);
      metrics.push({ offscreenCaptureRequiresNavigation: below });
      });
    }
    if (evidence) await writeFile(join(evidence, `${phase}-geometry.json`), JSON.stringify(metrics, null, 2));
    assert.deepEqual(posts, []);
    assert.deepEqual(browser.exceptions, []);
    await browser.call('Browser.close');
  });
