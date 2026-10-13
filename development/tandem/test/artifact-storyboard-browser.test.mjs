import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { browserAvailable, openFixtureBrowser } from './helpers/browser-fixture.mjs';
import { storyboardArtifacts, technicalArtifact } from './fixtures/artifact-storyboard.mjs';
import { validateArtifact } from '../public/artifacts/contract.js';

test('representative static storyboard and checkout interaction sequence render at authored breakpoints and host widths', {
  skip: !browserAvailable, timeout: 90_000,
}, async t => {
  for (const artifact of [...storyboardArtifacts, technicalArtifact]) validateArtifact(artifact);
  const root = fileURLToPath(new URL('../public/', import.meta.url));
  const scratch = resolve('.tandem', `storyboard-browser-${randomUUID()}`);
  await mkdir(scratch, { recursive: true });
  const browserCleanup = [];
  let server;
  // Redirect the existing helper's owned profile into this worktree, not OS temp.
  const oldTemp = process.env.TEMP, oldTmp = process.env.TMP, oldTmpDir = process.env.TMPDIR;
  process.env.TEMP = process.env.TMP = process.env.TMPDIR = scratch;
  t.after(async () => {
    try {
      for (const close of browserCleanup) await close();
    } finally {
      if (server) {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
      await rm(scratch, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
    }
  });
  let browser;
  try {
    browser = await openFixtureBrowser({ after: close => browserCleanup.push(close) });
  } finally {
    for (const [key, value] of [['TEMP', oldTemp], ['TMP', oldTmp], ['TMPDIR', oldTmpDir]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
  server = createServer(async (request, response) => {
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><head><style>body{margin:20px;background:#fafbf8;font-family:system-ui,sans-serif;color:#243d38}button{font:inherit}figure{background:white}</style></head><body></body></html>');
      return;
    }
    try {
      const path = resolve(root, `.${new URL(request.url, 'http://localhost').pathname}`);
      if (!path.startsWith(root.endsWith(sep) ? root : root + sep) || !path.endsWith('.js')) throw new Error('Not found');
      response.setHeader('Content-Type', 'text/javascript');
      response.end(await readFile(path));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false });
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await browser.waitFor('document.readyState === "complete"');
  const receipts = [];
  const screenshotDirectory = process.env.TANDEM_STORYBOARD_SCREENSHOTS;
  if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
  for (const artifact of [...storyboardArtifacts, technicalArtifact]) {
    for (const hostWidth of [360, 1080]) {
      const receipt = await browser.evaluate(`(async () => {
        window.currentFigure?.dispose();
        document.body.replaceChildren();
        const artifact = ${JSON.stringify(artifact)};
        const {renderArtifact} = await import('/artifacts/renderer.js');
        const panel = document.createElement('section');
        panel.dataset.artifactPanel = '';
        panel.style.cssText = 'width:${hostWidth}px;height:800px;overflow:hidden';
        document.body.append(panel);
        const figure = renderArtifact(document, artifact);
        window.currentFigure = figure;
        if (figure.captureElement !== null) throw new Error('Capture was exposed before ready');
        panel.append(figure);
        await figure.ready;
        figure.refreshLayout();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const frame = figure.captureElement;
        if (frame?.localName !== 'iframe' || frame.ownerDocument !== document
          || frame.getAttribute('sandbox') !== 'allow-same-origin'
          || !frame.matches('[data-artifact-surface]')) throw new Error('Capture surface is not the strict outer iframe');
        if (figure.querySelector('[role="alert"]') || figure.dataset.artifactError) throw new Error('Renderer reported an error');
        const inner = frame.contentDocument;
        const body = inner.body;
        const view = inner.defaultView;
        const outside = [];
        const tolerance = 2;
        const bodyBounds = body.getBoundingClientRect();
        const walker = inner.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        let node;
        while (node = walker.nextNode()) {
          if (!node.textContent.trim() || node.parentElement.closest('style,script,defs')) continue;
          const range = inner.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (!rect.width || !rect.height) continue;
            if (rect.left < -tolerance || rect.top < -tolerance || rect.right > artifact.width + tolerance || rect.bottom > artifact.height + tolerance)
              outside.push({text:node.textContent.trim(),reason:'authored canvas'});
            for (let ancestor = node.parentElement; ancestor && ancestor !== body; ancestor = ancestor.parentElement) {
              const style = view.getComputedStyle(ancestor);
              const bounds = ancestor.getBoundingClientRect();
              if (['hidden','clip'].includes(style.overflowX) && (rect.left < bounds.left - tolerance || rect.right > bounds.right + tolerance)
                || ['hidden','clip'].includes(style.overflowY) && (rect.top < bounds.top - tolerance || rect.bottom > bounds.bottom + tolerance))
                outside.push({text:node.textContent.trim(),reason:'clipping ancestor'});
            }
          }
        }
        const overflowing = [...body.querySelectorAll('*')].filter(element => {
          if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !element.clientWidth || !element.clientHeight || element.tagName === 'STYLE') return false;
          return element.scrollWidth > element.clientWidth + tolerance || element.scrollHeight > element.clientHeight + tolerance;
        }).map(element => element.className || element.tagName);
        const cards = [...body.querySelectorAll('.step')].map(element => {
          const bounds = element.getBoundingClientRect();
          return {x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height};
        });
        const metrics = {};
        if (artifact.format === 'mermaid') {
          const text = body.querySelector('svg text.messageText') ?? body.querySelector('svg text tspan') ?? body.querySelector('svg text');
          const node = body.querySelector('svg rect.actor') ?? body.querySelector('svg .node rect') ?? body.querySelector('svg rect');
          const line = body.querySelector('svg .messageLine0') ?? body.querySelector('svg .flowchart-link') ?? body.querySelector('svg line');
          for (const [name,element] of [['text',text],['node',node],['line',line]]) {
            if (element) {
              const style = view.getComputedStyle(element);
              metrics[name] = {fontFamily:style.fontFamily,fontSize:style.fontSize,fill:style.fill,stroke:style.stroke};
            }
          }
        }
        const visibleText = body.innerText;
        const fitBounds = frame.getBoundingClientRect();
        figure.querySelector('[data-artifact-zoom="actual"]').click();
        const nativeBounds = frame.getBoundingClientRect();
        figure.querySelector('[data-artifact-zoom="fit"]').click();
        return {id:artifact.id,format:artifact.format,hostWidth:${hostWidth},authoredWidth:artifact.width,authoredHeight:artifact.height,
          bodyWidth:bodyBounds.width,bodyHeight:bodyBounds.height,
          fitWidth:fitBounds.width,fitHeight:fitBounds.height,nativeWidth:nativeBounds.width,nativeHeight:nativeBounds.height,
          border:view.getComputedStyle(body).borderWidth,visibleText,cards,outside,overflowing,metrics};
      })()`);
      receipts.push(receipt);
      assert.equal(receipt.bodyWidth, artifact.width);
      assert.equal(receipt.bodyHeight, artifact.height);
      assert.equal(receipt.nativeWidth, artifact.width);
      assert.equal(receipt.nativeHeight, artifact.height);
      assert.equal(receipt.border, '0px');
      assert.ok(receipt.fitWidth <= hostWidth + 1);
      assert.ok(receipt.fitHeight <= 480 + 1);
      assert.ok(Math.abs(receipt.fitWidth / receipt.fitHeight - artifact.width / artifact.height) < 0.001);
      assert.deepEqual(receipt.outside, [], `${artifact.id}: text leaves native canvas or is clipped`);
      assert.deepEqual(receipt.overflowing, [], `${artifact.id}: source elements overflow`);
      if (artifact.format === 'html') {
        assert.equal(receipt.cards.length, 3);
        for (const label of ['User action', 'System response', 'Next state', 'Outcome:', 'If the time was just taken', 'without starting over']) assert.ok(receipt.visibleText.includes(label), label);
        if (artifact.width > 600) {
          assert.equal(receipt.cards[0].y, receipt.cards[1].y);
          assert.ok(receipt.cards[1].x > receipt.cards[0].x);
        } else {
          assert.equal(receipt.cards[0].x, receipt.cards[1].x);
          assert.ok(receipt.cards[1].y >= receipt.cards[0].y + receipt.cards[0].height);
        }
      } else {
        for (const label of ['Customer', 'Checkout UI', 'Order service', 'Payment provider', 'Confirm purchase',
          'Payment accepted', 'Payment declined', 'Order confirmed and receipt', 'Keep bag and offer retry',
          'Retry retained bag with new token']) assert.ok(receipt.visibleText.includes(label), label);
        assert.ok(receipt.metrics.text?.fontFamily);
        assert.ok(parseFloat(receipt.metrics.text?.fontSize) > 0);
        assert.ok(receipt.metrics.node?.fill);
        assert.ok(receipt.metrics.line?.stroke);
      }
      if (screenshotDirectory) await writeFile(resolve(screenshotDirectory, `${artifact.id}-host-${hostWidth}.png`), await browser.screenshot());
    }
  }
  assert.deepEqual(browser.exceptions, []);
  await browser.evaluate('window.currentFigure?.dispose(); document.body.replaceChildren();');
  if (screenshotDirectory) await writeFile(resolve(screenshotDirectory, 'storyboard-metrics.json'), JSON.stringify(receipts, null, 2));
  t.diagnostic(`Handcrafted example coverage only; not proof of general generation quality. Mermaid metrics: ${JSON.stringify(receipts.filter(receipt => receipt.format === 'mermaid').map(({ hostWidth, metrics }) => ({ hostWidth, metrics })))}`);
});
