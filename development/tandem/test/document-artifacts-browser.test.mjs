import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { browserAvailable, openFixtureBrowser } from './helpers/browser-fixture.mjs';

for (const zoomed of [false, true]) test(`document text is inert, narrow and capability gated while exact ${zoomed ? 'zoomed and panned' : 'Fit'} visual drafts survive references`, {
  skip: !browserAvailable, timeout: 60_000,
}, async t => {
  const root = fileURLToPath(new URL('../public/', import.meta.url));
  const scratch = resolve('.tandem', `documents-browser-${randomUUID()}`);
  await mkdir(scratch, { recursive: true });
  const cleanup = [];
  let server;
  t.after(async () => {
    for (const close of cleanup) await close();
    if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
    await rm(scratch, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
  });
  const old = Object.fromEntries(['TEMP', 'TMP', 'TMPDIR'].map(key => [key, process.env[key]]));
  let browser;
  try {
    for (const key of Object.keys(old)) process.env[key] = scratch;
    browser = await openFixtureBrowser({ after: close => cleanup.push(close) });
  } finally {
    for (const [key, value] of Object.entries(old)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const requests = [];
  server = createServer(async (request, response) => {
    requests.push(request.url);
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(`<!doctype html><style>body{margin:8px;font:16px system-ui}#panel{width:340px;height:650px;overflow:auto}#parking{height:80px;overflow:auto}
        .diagram-annotation-overlay{position:fixed;z-index:10;touch-action:none}.raw-block[hidden]{display:none}
        button{font:inherit}.artifact-navigation-row{display:flex;overflow:auto}</style>
        <div id="panel"><div id="tabs"></div><div id="backbone-proposal"></div></div><div id="parking"></div>`);
      return;
    }
    try {
      const path = resolve(root, `.${new URL(request.url, 'http://localhost').pathname}`);
      if (!path.startsWith(root.endsWith(sep) ? root : root + sep) || !/\.(js|json)$/.test(path)) throw new Error();
      response.setHeader('Content-Type', path.endsWith('.json') ? 'application/json' : 'text/javascript'); response.end(await readFile(path));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: false });
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await browser.waitFor("document.querySelector('#panel')");
  const source = '# Business contract\n\nNormal **selectable** text.\n\n|Name|Result|Constraint|Another|\n|---|---|---|---|\n|Checkout|Accepted|Required|Value|\n\n```js\n' +
    'const longLine = "' + 'x'.repeat(160) + '";\n```\n\n<script>globalThis.pwned=true</script>\n\n<img src="/evil-image" onerror="alert(1)">\n\n[Bad](javascript:alert(1)) ![Alt](/evil-image)\n\n' +
    '## More\n\nReadable vertical content.\n\n'.repeat(30);
  await browser.evaluate(`(async () => {
    const {createSharedDesignView}=await import('/renderers/shared-design.js');
    const {createAnnotationController,visibleDiagramRegion}=await import('/annotation-controller.js');
    globalThis.panel=document.querySelector('#panel');
    const make=tag=>document.createElement(tag);
    globalThis.controls=Object.fromEntries(['reset','capture','remove'].map(key=>[key,make('button')]));
    Object.assign(controls,{tools:make('div'),parking:document.querySelector('#parking'),status:make('p'),preview:make('div'),image:make('img'),caption:make('p')});
    controls.tools.append(controls.reset,controls.capture);
    controls.parking.append(controls.tools,controls.status,controls.preview);controls.preview.hidden=true;
    controls.preview.append(controls.image,controls.caption,controls.remove);
    globalThis.view=createSharedDesignView({tabs:document.querySelector('#tabs'),mount:document.querySelector('#backbone-proposal'),
      onChange:()=>globalThis.controller?.refresh(),onAnnotate:id=>controller.toggleArtifact(id)});
    globalThis.binding={revisionId:'revision-1',digest:'exact-digest'};
    globalThis.content={schemaVersion:'sketch-design/v3',goal:'Read and inspect',summary:'Documents and visual',outcomes:[{id:'read',description:'Read contract',references:['business']}],
      artifacts:[{schemaVersion:'artifact/v1',format:'html',id:'visual',title:'Visual',category:'experience',width:800,height:600,source:'<div id="card" style="background:lightblue;width:800px;height:600px">Visual card</div>'},
      {schemaVersion:'artifact/v2',format:'markdown',id:'business',title:'Business contract',category:'contracts-data',visualCompanionId:'visual',source:${JSON.stringify(source)}},
      {schemaVersion:'artifact/v2',format:'json-schema',id:'data',title:'Machine data',category:'contracts-data',source:JSON.stringify({$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',properties:{name:{type:'string',description:'Display name'}},required:['name'],$ref:'https://invalid.example/no-fetch'})},
      {schemaVersion:'artifact/v2',format:'openapi',id:'http-api',title:'HTTP API',category:'system',source:JSON.stringify({openapi:'3.1.1',jsonSchemaDialect:'https://json-schema.org/draft/2020-12/schema',info:{title:'Actual HTTP API',version:'1'},paths:{'/items':{get:{summary:'List items',responses:{200:{description:'Items'}}}}}})}]};
    content.artifacts.push(
      {schemaVersion:'artifact/v2',format:'markdown',id:'data-note',title:'Data rationale',noteForArtifactId:'data',source:'Only essential schema rationale.'},
      {schemaVersion:'artifact/v2',format:'markdown',id:'api-note',title:'API rationale',noteForArtifactId:'http-api',source:'Only essential API rationale.'});
    view.render({binding,content});
    globalThis.controller=createAnnotationController({panel,artifactMode:true,getCandidates:()=>view.candidates(),getView:()=>view.current(),
      selectArtifact:id=>view.selectArtifact(id),getArtifactLabel:id=>view.label(id),controls});
    await document.querySelector('figure').ready;
    if (${zoomed}) {
      document.querySelector('[data-artifact-zoom="actual"]').click();
      const viewport=document.querySelector('[data-artifact-viewport]');
      viewport.scrollLeft=100;viewport.scrollTop=40;
    }
    const candidate=view.candidates()[0];
    candidate.prepareCapture?.();
    globalThis.sourceBeforeCapture={...candidate.identity,viewport:visibleDiagramRegion(candidate.element,panel).viewport};
    controller.toggleArtifact('visual');
  })()`);
  await browser.waitFor("document.querySelector('.annotation-editor').open && !controller.isCapturing()");
  const point = await browser.evaluate(`(()=>{const b=document.querySelector('.annotation-editor-ink').getBoundingClientRect();return {x:b.left+35,y:b.top+35}})()`);
  await browser.call('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await browser.call('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: point.x + 40, y: point.y + 30 });
  await browser.call('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: point.x + 40, y: point.y + 30 });
  // Resume/Cancel controls can wrap the live toolbar after capture. Compare to
  // the actual captured crop, not the subsequently shifted live artifact.
  const before = await browser.evaluate('JSON.stringify(sourceBeforeCapture)');
  assert.deepEqual(await browser.evaluate(`(()=>{
    const image=document.querySelector('.annotation-editor-stage img');
    return [image.naturalWidth,image.naturalHeight];
  })()`), [JSON.parse(before).viewport.width, JSON.parse(before).viewport.height]);
  await browser.evaluate('document.querySelector("[data-annotation-action=close]").click()');
  const viewBefore = await browser.evaluate("document.querySelector('figure').getViewState()");
  assert.equal(viewBefore.fit, !zoomed);
  if (zoomed) { assert.equal(viewBefore.scale, 1); assert.equal(viewBefore.scrollLeft, 100); assert.equal(viewBefore.scrollTop, 40); }
  const strokeBefore = await browser.evaluate("document.querySelector('.annotation-editor-ink').toDataURL()");
  assert.deepEqual(await browser.evaluate("[...document.querySelectorAll('[data-artifact-tab]')].map(n=>n.dataset.artifactTab)"), ['visual', 'data', 'http-api']);
  const result = await browser.evaluate(`(async()=>{
    document.querySelector('[data-artifact-note="business"]').click(); await document.querySelector('figure').ready;
    const figure=document.querySelector('figure');
    figure.querySelector('[data-markdown-source]').open=true;
    const {captureAnnotatedDiagram}=await import('/annotation-capture.js');
    let rejected=false;try{await captureAnnotatedDiagram(figure,{x:0,y:0,width:100,height:100,scale:1},[])}catch{rejected=true}
    return {candidates:view.candidates().length,toolbar:!!figure.querySelector('[data-artifact-zoom]'),
      annotate:!!panel.querySelector('[data-annotate-artifact]'),hidden:controls.tools.hidden,captureDisabled:controls.capture.disabled,
      captureRejected:rejected,headings:figure.querySelectorAll('h1,h2').length,tables:figure.querySelectorAll('table').length,
      code:figure.querySelector('pre code').textContent,active:figure.querySelectorAll('script,img,iframe,a,input').length,
      literal:figure.textContent.includes('<script>'),pwned:!!globalThis.pwned,source:content.artifacts[1].source,
      width:figure.getBoundingClientRect().width,scrollWidth:figure.scrollWidth,
      overflow:[...figure.querySelectorAll('[data-document-overflow]')].map(n=>n.scrollWidth>n.clientWidth),
      vertical:panel.scrollHeight>panel.clientHeight,selectable:getComputedStyle(figure).userSelect};
  })()`);
  assert.equal(result.candidates, 0); assert.equal(result.toolbar, false); assert.equal(result.annotate, false);
  assert.equal(result.hidden, true); assert.equal(result.captureDisabled, true); assert.equal(result.captureRejected, true);
  assert.ok(result.headings > 2); assert.equal(result.tables, 1); assert.match(result.code, /const longLine/);
  assert.equal(result.active, 0); assert.equal(result.literal, true); assert.equal(result.pwned, false);
  assert.equal(result.source, source); assert.ok(result.scrollWidth <= Math.ceil(result.width));
  assert.deepEqual(result.overflow, [true, true]); assert.equal(result.vertical, true); assert.equal(result.selectable, 'text');
  const themed = await browser.evaluate(`(()=>{
    panel.style.setProperty('--artifact-document-font-size','20px');
    panel.style.setProperty('--artifact-document-color','rgb(20, 40, 60)');
    panel.style.setProperty('--artifact-document-border','rgb(60, 80, 100)');
    const figure=document.querySelector('figure'),style=getComputedStyle(figure);
    const result={size:style.fontSize,color:style.color,border:getComputedStyle(figure.querySelector('td')).borderTopColor};
    for(const key of ['font-size','color','border'])panel.style.removeProperty('--artifact-document-'+key);
    return result;
  })()`);
  assert.deepEqual(themed, { size: '20px', color: 'rgb(20, 40, 60)', border: 'rgb(60, 80, 100)' });
  if (process.env.TANDEM_DOCUMENT_SCREENSHOTS) {
    await mkdir(process.env.TANDEM_DOCUMENT_SCREENSHOTS, { recursive: true });
    await writeFile(resolve(process.env.TANDEM_DOCUMENT_SCREENSHOTS, 'document-narrow.png'), await browser.screenshot());
  }
  await browser.evaluate(`view.inspectReference(binding,'data')`);
  await browser.waitFor("document.querySelector('[data-artifact-format=\"json-schema\"]')");
  await browser.evaluate("document.querySelector('[data-artifact-note=\"data-note\"]').click()");
  assert.equal(await browser.evaluate("view.current().artifactId"), 'data-note');
  assert.equal(await browser.evaluate("document.activeElement.dataset.notePrimary"), 'data');
  assert.equal(await browser.evaluate("document.querySelector('[data-artifact-tab=data]').getAttribute('aria-pressed')"), 'true');
  await browser.evaluate("document.querySelector('[data-note-primary=data]').click()");
  assert.equal(await browser.evaluate("document.activeElement.dataset.artifactNote"), 'data-note');
  assert.equal(await browser.evaluate('view.candidates().length'), 0);
  assert.match(await browser.evaluate("document.querySelector('.contract-field summary').textContent"), /name.*string.*Required/);
  assert.equal(await browser.evaluate("document.querySelectorAll('.contract-visual pre, .contract-visual table').length"), 0);
  await browser.evaluate(`(async()=>{
    const {renderDocument}=await import('/artifacts/documents.js');
    const node=renderDocument(document,{schemaVersion:'artifact/v2',format:'json-schema',id:'regression',title:'Fields',source:JSON.stringify({
      $schema:'https://json-schema.org/draft/2020-12/schema',properties:{customer:{$ref:'#/$defs/customer'}},
      $defs:{customer:{type:'object',properties:{name:{type:'string',minLength:1}},required:['name']}}
    })});
    node.id='schema-regression';panel.append(node);
  })()`);
  assert.match(await browser.evaluate("document.querySelector('#schema-regression details > summary').textContent"), /Unspecified type/);
  await browser.evaluate("document.querySelector('#schema-regression .contract-visual button').click()");
  assert.equal(await browser.evaluate("document.activeElement.parentElement.dataset.schemaPointer"), '#/$defs/customer');
  assert.equal(await browser.evaluate("document.activeElement.parentElement.open"), true);
  await browser.evaluate("document.querySelector('#schema-regression').remove()");
  if (process.env.TANDEM_DOCUMENT_SCREENSHOTS) await writeFile(resolve(process.env.TANDEM_DOCUMENT_SCREENSHOTS, 'schema-narrow.png'), await browser.screenshot());
  await browser.evaluate(`view.inspectReference(binding,'http-api')`);
  await browser.waitFor("document.querySelector('[data-artifact-format=\"openapi\"]')");
  await browser.evaluate("document.querySelector('[data-artifact-note=\"api-note\"]').click()");
  assert.equal(await browser.evaluate("view.current().artifactId"), 'api-note');
  await browser.evaluate("document.querySelector('[data-note-primary=\"http-api\"]').click()");
  assert.equal(await browser.evaluate("document.querySelector('[data-api-operation]').dataset.apiOperation"), 'GET /items');
  assert.equal(await browser.evaluate("document.querySelector('[data-api-response]').dataset.apiResponse"), '200');
  assert.equal(await browser.evaluate(`(()=>{
    const boxes=[...document.querySelectorAll('.contract-exchange > .contract-stage')].map(n=>n.getBoundingClientRect());
    return boxes[0].bottom <= boxes[1].top && boxes[1].bottom <= boxes[2].top;
  })()`), true, 'narrow exchange arrows follow one vertical sequence instead of ambiguous wrapping');
  await browser.evaluate(`(async()=>{
    const {renderDocument}=await import('/artifacts/documents.js');
    const node=renderDocument(document,{schemaVersion:'artifact/v2',format:'openapi',id:'regression',title:'API',source:JSON.stringify({
      openapi:'3.1.1',jsonSchemaDialect:'https://json-schema.org/draft/2020-12/schema',info:{title:'Override',version:'1'},
      paths:{'/items':{parameters:[{name:'limit',in:'query',required:true,schema:{type:'integer',maximum:100}}],
        get:{parameters:[{name:'limit',in:'query',required:false,schema:{type:'integer',maximum:10}}],
          responses:{200:{description:'Accepted'},400:{description:'Rejected'}}}}}
    })});node.id='api-regression';panel.append(node);
  })()`);
  assert.equal(await browser.evaluate("[...document.querySelectorAll('#api-regression summary')].filter(n=>n.textContent.includes('query: limit')).length"), 1);
  assert.match(await browser.evaluate("document.querySelector('#api-regression .contract-stage').textContent"), /Optional.*maximum10/s);
  assert.equal(await browser.evaluate("document.querySelectorAll('#api-regression [data-api-response]').length"), 2);
  await browser.evaluate("document.querySelector('#api-regression').remove()");
  assert.equal(await browser.evaluate('view.candidates().length'), 0);
  if (process.env.TANDEM_DOCUMENT_SCREENSHOTS) await writeFile(resolve(process.env.TANDEM_DOCUMENT_SCREENSHOTS, 'openapi-narrow.png'), await browser.screenshot());
  await browser.evaluate(`view.selectArtifact('business'); document.querySelector('[data-visual-companion="visual"]').click()`);
  await browser.evaluate(`document.querySelector('figure').ready`);
  assert.deepEqual(await browser.evaluate("document.querySelector('figure').getViewState()"), viewBefore);
  await browser.evaluate("controller.toggleArtifact('visual')");
  await browser.waitFor('document.querySelector(".annotation-editor").open');
  assert.equal(await browser.evaluate('controller.preview()'), null);
  const strokes = await browser.evaluate(`(()=>{const c=document.querySelector('.annotation-editor-ink'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return d.some((v,i)=>i%4===3&&v>0)})()`);
  assert.equal(strokes, true, 'visual stroke draft survives document and external reference visits');
  assert.equal(await browser.evaluate("document.querySelector('.annotation-editor-ink').toDataURL()"), strokeBefore);
  await browser.evaluate('document.querySelector("[data-annotation-action=close]").click()');
  await browser.evaluate(`(async()=>{
    document.querySelector('[data-artifact-group="contracts-data"]').click();
    await document.querySelector('figure').ready;
    document.querySelector('[data-artifact-group="ungrouped"]').click();
    await document.querySelector('figure').ready;
  })()`);
  assert.deepEqual(await browser.evaluate("document.querySelector('figure').getViewState()"), viewBefore);
  assert.equal(await browser.evaluate("document.querySelector('.annotation-editor-ink').toDataURL()"), strokeBefore);
  if (process.env.TANDEM_DOCUMENT_SCREENSHOTS) {
    await writeFile(resolve(process.env.TANDEM_DOCUMENT_SCREENSHOTS, `visual-${zoomed ? 'zoomed-panned' : 'fit'}-restored.png`), await browser.screenshot());
  }
  await browser.evaluate("panel.style.width='290px'");
  await browser.evaluate(`(async()=>{
    view.selectArtifact('business');await document.querySelector('figure').ready;
    view.selectArtifact('visual');await document.querySelector('figure').ready;
  })()`);
  await browser.evaluate("controller.toggleArtifact('visual')");
  assert.equal(await browser.evaluate("document.querySelector('[data-annotation-action=attach]').disabled"), false);
  assert.equal(await browser.evaluate("document.querySelector('.annotation-editor-ink').toDataURL()"), strokeBefore, 'A live resize cannot alter the static captured draft.');
  await browser.evaluate('document.querySelector("[data-annotation-action=attach]").click()');
  await browser.waitFor('!controller.isCapturing() && controller.preview()');
  assert.equal(await browser.evaluate('JSON.stringify(controller.preview().source)'), before, 'resize never rebinds the unfinished snapshot before final attachment');
  assert.equal(requests.some(path => path.includes('evil')), false);
  assert.deepEqual(browser.exceptions, []);
  await browser.evaluate('controller.close()');
});
