import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { commandJourney } from './fixtures/sequence-punctuation.mjs';

const executable = process.env.TANDEM_BROWSER_EXECUTABLE ?? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
test('local browser renders all passive artifact formats and exposes same-origin capture surfaces', { skip: !existsSync(executable), timeout: 60_000 }, async t => {
  const root = fileURLToPath(new URL('../public/', import.meta.url));
  const profile = resolve('.tandem', `artifact-browser-${randomUUID()}`);
  await mkdir(profile, { recursive: true });
  const server = createServer(async (request, response) => {
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><body></body></html>'); return; }
    try {
      const path = resolve(root, `.${request.url}`);
      if (!path.startsWith(root) || !path.endsWith('.js')) throw new Error('not found');
      response.setHeader('Content-Type', 'text/javascript');
      response.end(await readFile(path));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const child = spawn(executable, ['--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let socket;
  t.after(async () => {
    socket?.close();
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), pause(2000)]);
    }
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
  });
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { await pause(100); }
  }
  assert.ok(port, 'owned browser exposes its debug port');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (request) { pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  await call('Page.enable');
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await pause(250);
  const result = await call('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
    const {renderArtifact} = await import('/artifacts/renderer.js');
    const outputs = [];
    for (const [format,source] of [
      ['html','<style>.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media (max-width:900px){.grid{color:rgb(255,0,0)}}</style><div class="grid"><button type="button" id="save">Save</button><span>Grid</span></div>'],
      ['svg','<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect id="card" width="100" height="100" fill="red"/><text x="10" y="150">Hello</text></svg>'],
      ['mermaid','flowchart LR\\nstart[Start] --> finish[Finish]'],
      ['mermaid','sequenceDiagram\\nAlice->>Bob: Hello\\nBob-->>Alice: Hi'],
      ['mermaid','stateDiagram-v2\\n[*] --> Ready\\nReady --> Done'],
      ['mermaid','graph LR\\nsubgraph Frontend\\nA[Browser]:::client\\nend\\nA --> B[Service]\\nclassDef client fill:#deebfa,stroke:#547c65,color:#243d38,stroke-width:2px'],
      ['mermaid','erDiagram\\nUSER ||--o{ ORDER : places\\nUSER {\\nint id PK\\nstring email UK\\n}\\nORDER {\\nint id PK\\nint user_id FK\\n}'],
      ['mermaid','classDiagram\\nAnimal <|-- Dog\\nRepository <|.. Dog\\nDog *-- Collar\\nOwner o-- Dog\\nclass Dog {\\n+String name\\n+bark()\\n}\\nclass Repository {\\n<<interface>>\\n+save()\\n}'],
    ]) {
      const selected = [];
      const figure = renderArtifact(document,{schemaVersion:'artifact/v1',format,id:'example',title:'Example',source,width:800,height:600},{onSelect:item=>selected.push(item.id)});
      const beforeReady = figure.captureElement;
      const panel = document.createElement('div');
      panel.dataset.artifactPanel = '';
      panel.style.cssText = 'width:400px;height:320px';
      document.body.append(panel);
      panel.append(figure);
      await figure.ready;
      const capture = figure.captureElement;
      const sourceRoot = capture.contentDocument.body;
      const target = sourceRoot.querySelector('[id]');
      if (target) target.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      const bounds = capture.getBoundingClientRect();
      let png = null;
      if (/^(erDiagram|classDiagram)/.test(source)) {
        const {captureAnnotatedDiagram} = await import('/annotation-capture.js');
        const blob = await captureAnnotatedDiagram(capture, {x:0,y:0,width:Math.floor(bounds.width),height:Math.floor(bounds.height)},
          [[{x:10,y:10},{x:30,y:10}]]);
        const image = new Image(), url = URL.createObjectURL(blob);
        image.src=url;await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        const context=canvas.getContext('2d');context.drawImage(image,0,0);URL.revokeObjectURL(url);
        png={type:blob.type,width:image.width,height:image.height,stroke:[...context.getImageData(20,10,1,1).data]};
      }
      const annotationToolbar = document.createElement('div');
      annotationToolbar.style.height = '60px';
      panel.prepend(annotationToolbar);
      panel.style.marginTop = '2000px';
      figure.refreshLayout();
      const pinnedBounds = capture.getBoundingClientRect();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const observedBounds = capture.getBoundingClientRect();
      if (pinnedBounds.width !== bounds.width || observedBounds.width !== pinnedBounds.width) throw new Error('Annotation toolbar or offscreen position changed the pinned fit');
      panel.style.marginTop = '0';
      figure.querySelector('[data-artifact-zoom="actual"]').click();
      const authoredBounds = capture.getBoundingClientRect();
      figure.querySelector('[data-artifact-zoom="fit"]').click();
      panel.style.width = '200px';
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const resizedBounds = capture.getBoundingClientRect();
      outputs.push({format,png,beforeReady,text:sourceRoot.textContent,selected,width:bounds.width,height:bounds.height,sandbox:capture.getAttribute('sandbox'),svg:!!sourceRoot.querySelector('svg'),
        erColors: source.startsWith('erDiagram') ? {
          foreground:capture.contentWindow.getComputedStyle(sourceRoot.querySelector('.edgeLabel text')).fill,
          background:capture.contentWindow.getComputedStyle(sourceRoot.querySelector('.edgeLabel .background')).fill } : null,
        authoredWidth:authoredBounds.width,authoredHeight:authoredBounds.height,resizedWidth:resizedBounds.width,
        color:target ? sourceRoot.ownerDocument.defaultView.getComputedStyle(target).color : null,
        outerColor:getComputedStyle(document.body).color});
      figure.dispose();
      if (figure.captureElement !== null) throw new Error('disposed capture remained available');
      panel.remove();
    }
    const pendingFigure = renderArtifact(document,{schemaVersion:'artifact/v1',format:'html',id:'pending',title:'Pending',source:'<div>Pending</div>',width:800,height:600});
    pendingFigure.dispose();
    try { await pendingFigure.ready; throw new Error('Disposed render unexpectedly succeeded'); }
    catch (error) { if (!error.message.includes('disposed')) throw error; }
    if (pendingFigure.captureElement !== null) throw new Error('Disposed pending capture remained available');
    const broken = renderArtifact(document,{schemaVersion:'artifact/v1',format:'mermaid',id:'broken',title:'Broken',source:'flowchart LR\\nnode[',width:800,height:600});
    document.body.append(broken);
    let rejected = false;
    try { await broken.ready; } catch { rejected = true; }
    if (!rejected || broken.captureElement !== null || !broken.querySelector('[role="alert"]')) throw new Error('Failed renderer did not expose an explicit non-capturable error');
    broken.dispose(); broken.remove();
    const [retained, corrected] = ${JSON.stringify([commandJourney(), commandJourney({ escaped: true })])};
    const failedSequence = renderArtifact(document,retained);
    document.body.append(failedSequence);
    let sequenceError = '';
    try { await failedSequence.ready; } catch (error) { sequenceError = error.message; }
    if (!sequenceError || failedSequence.captureElement !== null || !failedSequence.querySelector('[role="alert"]')) throw new Error('Retained malformed sequence must fail visibly without a capture surface');
    failedSequence.dispose(); failedSequence.remove();
    const fixedSequence = renderArtifact(document,corrected);
    document.body.append(fixedSequence);
    await fixedSequence.ready;
    const sequenceText = [...fixedSequence.captureElement.contentDocument.querySelectorAll('svg text')].map(node=>node.textContent).join('\\n');
    fixedSequence.dispose(); fixedSequence.remove();
    return {outputs,sequenceError,sequenceText};
  })()` });
  assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
  const { outputs, sequenceError, sequenceText } = result.result.value;
  assert.match(sequenceError, /Parse error on line 7/);
  for (const text of [
    'stdout MM:SS plus newline; exit 0',
    'Total minutes do not wrap; seconds have two digits',
    'Minutes have at least two digits; 5 seconds becomes 00:05',
    'Short stderr diagnostic; empty stdout; exit 2',
    'Valid retry returns formatted duration and exit 0',
  ]) assert.ok(sequenceText.includes(text), `Rendered sequence preserves literal punctuation: ${text}`);
  assert.doesNotMatch(sequenceText, /#59;/);
  assert.equal(outputs.length, 8);
  assert.deepEqual(outputs[6].erColors, { foreground: 'rgb(36, 61, 56)', background: 'rgb(245, 242, 233)' });
  assert.match(outputs[6].text, /places/);
  assert.match(outputs[7].text, /bark/);
  for (const output of outputs.slice(6)) {
    assert.equal(output.png.type, 'image/png');
    assert.equal(output.png.width, Math.floor(output.width)); assert.equal(output.png.height, Math.floor(output.height));
    assert.deepEqual(output.png.stroke, [228, 93, 52, 255]);
  }
  assert.match(outputs[0].text, /Save/);
  assert.deepEqual(outputs[0].selected, ['save']);
  assert.equal(outputs[0].outerColor, 'rgb(0, 0, 0)', 'source CSS stays inside iframe');
  assert.deepEqual(outputs[1].selected, ['card']);
  for (const output of outputs) {
    assert.equal(output.beforeReady, null);
    assert.ok(output.width <= 400); assert.ok(output.height <= 320);
    assert.ok(Math.abs(output.width / output.height - 800 / 600) < 0.001);
    assert.equal(output.authoredWidth, 800); assert.equal(output.authoredHeight, 600);
    assert.ok(output.resizedWidth <= 200);
    if (output.format === 'mermaid') { assert.ok(output.svg); assert.deepEqual(output.selected, []); }
    assert.equal(output.sandbox, 'allow-same-origin');
  }
});
