import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname, join } from 'node:path';
import test from 'node:test';
import { openFixtureBrowser, browserAvailable } from './helpers/browser-fixture.mjs';
import { HEADER_HEIGHT, SKETCH_PROFILES, SKETCH_TREATMENTS } from '../public/sketch/contract.js';
import { fanoutCrossingSketch } from './fixtures/sketch-routing.mjs';
import { mailSketch, shapeSketch } from './fixtures/sketch-v2.mjs';

const root = resolve(import.meta.dirname, '../public');
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;font:14px system-ui;background:var(--background-color-default,#fff);color:var(--text-color-default,#17212b)}
#panel{width:780px;max-width:100%;height:570px;overflow:auto;border:1px solid #aaa;box-sizing:border-box}
.panel-heading,.perspective-toolbar{padding:8px;background:var(--background-color-default,#fff)}
.perspective-toolbar{display:flex;flex-wrap:wrap;gap:6px}
#annotation-tools{width:100%}[hidden]{display:none!important}
.diagram-annotation-overlay{position:fixed;z-index:10;touch-action:none}
#preview img{max-width:300px}button{font:inherit}
</style>
<section id="panel"><div class="panel-heading">Renderer and annotation fixture</div>
<div id="backbone-proposal"><section class="backbone-view" data-design-artifact="workflow-example">
<div class="perspective-toolbar"><button id="annotate" data-annotate-artifact="workflow-example">Annotate</button></div>
<div id="mount"></div></section></div>
<div id="parking" hidden><div id="annotation-tools" class="diagram-annotation-tools" hidden>
<button id="annotation-reset">Reset sketch</button><button id="capture">Capture</button><span id="annotation-status"></span></div></div></section>
<div id="preview" hidden><img id="image"><span id="caption"></span><button id="remove">Remove</button></div><pre id="details"></pre>`;
async function fixture(t) {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') { response.setHeader('content-type', 'text/html'); response.end(html); return; }
    const file = resolve(root, path.slice(1)), tail = relative(root, file);
    if (tail.startsWith('..') || isAbsolute(tail)) { response.writeHead(403).end(); return; }
    try {
      response.setHeader('content-type', extname(file) === '.json' ? 'application/json' : extname(file) === '.js' ? 'text/javascript' : 'text/plain');
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); });
  const browser = await openFixtureBrowser(t);
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await browser.waitFor("document.querySelector('#mount')");
  await browser.evaluate(`(async()=>{
    const {renderSketch,layoutSketch}=await import('/sketch/renderer.js');
    const {createLegacyTemplate:createTemplate,templateCatalog}=await import('/sketch/templates.js');
    const {createAnnotationController}=await import('/annotation-controller.js');
    window.api={renderSketch,layoutSketch,createTemplate,templateCatalog,createAnnotationController};
    window.values=new Map(templateCatalog.map(({id})=>[id,createTemplate(id)]));
    window.selections=[];
    window.show=(id,width=780)=>{
      document.querySelector('#panel').style.width=width+'px';
      const value=values.get(id);
      document.querySelector('.backbone-view').dataset.designArtifact=value.id;
      document.querySelector('#annotate').dataset.annotateArtifact=value.id;
      document.querySelector('#mount').replaceChildren(renderSketch(document,value,{onSelect:item=>{selections.push(item);document.querySelector('#details').textContent=item.details;}}));
    };
    show('workflow');
  })()`);
  await browser.waitFor("document.querySelector('.shared-sketch').dataset.viewMode === 'fit'");
  return browser;
}
async function evidence(browser, name, extra) {
  if (!process.env.SKETCH_PRESENTATION_EVIDENCE) return;
  await mkdir(process.env.SKETCH_PRESENTATION_EVIDENCE, { recursive: true });
  await writeFile(join(process.env.SKETCH_PRESENTATION_EVIDENCE, `${name}.png`), await browser.screenshot());
  await writeFile(join(process.env.SKETCH_PRESENTATION_EVIDENCE, `${name}.json`), JSON.stringify(extra, null, 2));
}
const luminance = rgb => rgb.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
  .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (high + .05) / (low + .05);
};
async function measure(browser) {
  return browser.evaluate(`(()=>{
    const svg=document.querySelector('.shared-sketch svg'), figure=svg.parentElement;
    const boxes=[...svg.querySelectorAll('[data-sketch-box]')].map(g=>{
      const r=g.querySelector('rect').getBBox(), t=g.querySelector('text').getBBox();
      return {id:g.dataset.sketchBox,container:!!g.querySelector('.sketch-container'),x:r.x,y:r.y,w:r.width,h:r.height,
        text:{x:t.x,y:t.y,w:t.width,h:t.height},font:parseFloat(getComputedStyle(g.querySelector('text')).fontSize)};
    });
    const edges=[...svg.querySelectorAll('[data-sketch-connection]')].map(g=>{
      const path=g.querySelector('path'), rect=g.querySelector('rect')?.getBBox(), text=g.querySelector('text')?.getBBox();
      const points=[...g.querySelector('polygon').points].map(p=>({x:p.x,y:p.y}));
      const end=path.getPointAtLength(path.getTotalLength());
      return {id:g.dataset.sketchConnection,d:path.getAttribute('d'),points,end:{x:end.x,y:end.y},
        rect:rect&&{x:rect.x,y:rect.y,w:rect.width,h:rect.height},text:text&&{x:text.x,y:text.y,w:text.width,h:text.height},
        font:g.querySelector('text')&&parseFloat(getComputedStyle(g.querySelector('text')).fontSize)};
    });
    return {width:svg.getBoundingClientRect().width,height:svg.getBoundingClientRect().height,viewBox:[...svg.viewBox.baseVal? [svg.viewBox.baseVal.width,svg.viewBox.baseVal.height]:[]],
      client:figure.clientWidth,scroll:figure.scrollWidth,scaleX:Number(svg.dataset.displayScaleX),scaleY:Number(svg.dataset.displayScaleY),
      page:document.documentElement.scrollWidth,viewport:innerWidth,title:svg.querySelector(':scope > title')?.textContent??null,
      accessibleName:svg.getAttribute('aria-label'),boxes,edges};
  })()`);
}

test('v2 mail and shared shapes retain readable text, actual outlines, theme-safe fills and PNG fidelity', { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const browser = await fixture(t);
  await browser.evaluate(`values.set('v2-mail',${JSON.stringify(mailSketch)});values.set('v2-shapes',${JSON.stringify(shapeSketch)})`);
  for (const id of ['v2-mail', 'v2-shapes']) for (const theme of ['light', 'dark']) {
    await browser.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await browser.evaluate(`show('${id}',1000)`);
    await new Promise(done => setTimeout(done, 100));
    const measurement = await browser.evaluate(`(()=>{
      const svg=document.querySelector('#mount svg'),pixel=document.createElement('canvas').getContext('2d');
      const color=value=>{pixel.clearRect(0,0,1,1);pixel.fillStyle=value;pixel.fillRect(0,0,1,1);return [...pixel.getImageData(0,0,1,1).data]};
      return {width:svg.getBoundingClientRect().width,height:svg.getBoundingClientRect().height,
        nodes:[...svg.querySelectorAll('[data-sketch-box]')].map(g=>{
          const shape=g.querySelector('.sketch-box'),r=shape.getBBox();
          return {id:g.dataset.sketchBox,shape:g.dataset.sketchShape,rect:{x:r.x,y:r.y,w:r.width,h:r.height},
            filled:g.classList.contains('sketch-filled'),fill:color(getComputedStyle(shape).fill),
            texts:[...g.querySelectorAll('text[data-text-role]')].map(text=>{const b=text.getBBox();return{
              role:text.dataset.textRole,font:parseFloat(getComputedStyle(text).fontSize),fill:color(getComputedStyle(text).fill),
              x:b.x,y:b.y,w:b.width,h:b.height,value:text.textContent}})};
        }),edges:[...svg.querySelectorAll('[data-sketch-connection]')].map(g=>({
          id:g.dataset.sketchConnection,arrows:g.querySelectorAll('.sketch-arrow').length,
          dashed:g.querySelector('path').getAttribute('stroke-dasharray'),
          start:(()=>{const p=g.querySelector('path').getPointAtLength(0);return{x:p.x,y:p.y}})(),
          end:(()=>{const path=g.querySelector('path'),p=path.getPointAtLength(path.getTotalLength());return{x:p.x,y:p.y}})()}))};
    })()`);
    const luminance = color => color.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      .reduce((sum, v, index) => sum + v * [.2126, .7152, .0722][index], 0);
    for (const node of measurement.nodes) {
      if (node.shape === 'circle') assert.ok(Math.abs(node.rect.w - node.rect.h) < 1e-6);
      for (const text of node.texts) {
        assert.ok(text.font >= (text.role === 'caption' ? 12 : 14));
        assert.ok(text.x >= node.rect.x && text.x + text.w <= node.rect.x + node.rect.w + .01, JSON.stringify({ node, text }));
        assert.ok(text.y >= node.rect.y && text.y + text.h <= node.rect.y + node.rect.h + .01, JSON.stringify({ node, text }));
        if (node.filled) {
          const [high, low] = [luminance(node.fill), luminance(text.fill)].sort((a,b)=>b-a);
          assert.ok((high+.05)/(low+.05) >= 4.5, `${node.id}: filled text contrast`);
        }
      }
    }
    if (id === 'v2-shapes') {
      assert.deepEqual(measurement.edges.map(edge => [edge.id, edge.arrows]), [['association', 0], ['exchange', 2], ['request', 1]]);
      assert.ok(measurement.edges.find(edge => edge.id === 'exchange').dashed);
      const circle = measurement.nodes.find(node => node.id === 'person').rect;
      const start = measurement.edges.find(edge => edge.id === 'request').start, radius = circle.w / 2;
      assert.ok(Math.abs(((start.x-circle.x-radius)/radius)**2+((start.y-circle.y-radius)/radius)**2-1)<1e-5);
    }
    const capture = await browser.evaluate(`(async()=>{
      const {captureAnnotatedDiagram}=await import('/annotation-capture.js');
      const svg=document.querySelector('#mount svg'),r=svg.getBoundingClientRect();
      const blob=await captureAnnotatedDiagram(svg,{x:0,y:0,width:r.width,height:r.height},[]);
      const image=await createImageBitmap(blob);
      return {width:image.width,height:image.height,bytes:blob.size};
    })()`);
    assert.equal(capture.width, measurement.width); assert.equal(capture.height, measurement.height);
    assert.ok(capture.bytes > 1000);
    await evidence(browser, `${id}-${theme}`, { measurement, capture });
  }
  await browser.evaluate("document.querySelector('[data-sketch-box=\"service\"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
  assert.equal(await browser.evaluate('selections.at(-1).caption'), 'Accept a request');
  assert.equal(await browser.evaluate('selections.at(-1).body'), 'Return an explicit result.');
  await browser.evaluate("document.querySelector('[data-sketch-view-action=in]').click()");
  const ratio = await browser.evaluate("(()=>{const r=document.querySelector('[data-sketch-box=\"person\"] circle').getBBox();return r.width/r.height})()");
  assert.equal(ratio, 1, 'Local zoom never turns a circle into an ellipse.');
  await browser.evaluate(`(()=>{
    document.querySelector('[data-sketch-view-action=fit]').click();
    const $=id=>document.getElementById(id);
    window.v2Annotation=api.createAnnotationController({panel:$('panel'),artifactMode:true,
      getView:()=>({artifactId:'shared-shapes',revisionId:'v2-revision',designDigest:'b'.repeat(64)}),
      selectArtifact:()=>{},getArtifactLabel:()=> 'Shared shapes',
      getCandidates:()=>[{element:$('mount').querySelector('svg'),label:'Shared shapes',identity:{
        schemaVersion:'artifact-annotation/v1',artifactId:'shared-shapes',revisionId:'v2-revision',designDigest:'b'.repeat(64),selectionId:null}}],
      controls:{tools:$('annotation-tools'),parking:$('parking'),reset:$('annotation-reset'),capture:$('capture'),
        status:$('annotation-status'),preview:$('preview'),image:$('image'),caption:$('caption'),remove:$('remove')}});
    $('annotate').onclick=()=>v2Annotation.toggleArtifact('shared-shapes');
    v2Annotation.refresh();$('annotate').click();
  })()`);
  await browser.waitFor("document.querySelector('.annotation-editor').open && !v2Annotation.isCapturing()");
  const pinned = await browser.evaluate("document.querySelector('.annotation-editor-base').src");
  await browser.evaluate("show('v2-shapes',650)");
  await new Promise(done=>setTimeout(done,100));
  assert.equal(await browser.evaluate("document.querySelector('.annotation-editor-base').src"), pinned,
    'A captured circle diagram preserves its pixels across live remounts.');
  await browser.evaluate("document.querySelector('[data-sketch-view-action=in]').dispatchEvent(new Event('click'))");
  assert.equal(await browser.evaluate("document.querySelector('.annotation-editor-base').src"), pinned);
  assert.deepEqual(browser.exceptions, []);
});

test('named filled groups preserve quiet text and connector contrast through PNG capture in both themes', { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const browser = await fixture(t);
  for (const profile of SKETCH_PROFILES) for (const theme of ['light', 'dark']) {
    const input = { schemaVersion: 'sketch/v2', id: 'filled-context', title: 'Filled context',
      boxes: [
        { id: 'group', label: 'Context', x: 0, y: 0, w: 30, h: 20, appearance: { profile, treatment: 'filled' } },
        { id: 'note', label: 'Visible note', body: 'Text remains readable.', shape: 'none', parent: 'group', x: 2, y: 4, w: 24, h: 5,
          appearance: { treatment: 'quiet' } },
        { id: 'a', label: 'One', parent: 'group', x: 2, y: 12, w: 8, h: 4 },
        { id: 'b', label: 'Two', parent: 'group', x: 19, y: 12, w: 8, h: 4 },
      ], connections: [{ id: 'link', from: 'a', to: 'b' }] };
    await browser.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await browser.evaluate(`values.set('filled',${JSON.stringify(input)});show('filled',780)`);
    await new Promise(done=>setTimeout(done,60));
    const colors = await browser.evaluate(`(async()=>{
      const {captureAnnotatedDiagram}=await import('/annotation-capture.js');
      const svg=document.querySelector('#mount svg'),r=svg.getBoundingClientRect();
      const c=document.createElement('canvas'),context=c.getContext('2d');
      const color=value=>{context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data]};
      const group=svg.querySelector('[data-sketch-box=group] .sketch-box'),note=svg.querySelector('[data-sketch-box=note] text');
      const path=svg.querySelector('[data-sketch-connection=link] > path'),center=path.getPointAtLength(path.getTotalLength()/2);
      const image=await createImageBitmap(await captureAnnotatedDiagram(svg,{x:0,y:0,width:r.width,height:r.height},[]));
      c.width=image.width;c.height=image.height;context.drawImage(image,0,0);
      const pixels=[-1,0,1].map(d=>[...context.getImageData(Math.floor(center.x),Math.floor(center.y)+d,1,1).data]);
      const background=[...context.getImageData(Math.floor(center.x),Math.floor(center.y)+8,1,1).data];
      const texts=[...svg.querySelectorAll('[data-sketch-box=group] text,[data-sketch-box=note] text')].map(text=>{
        const b=text.getBBox(),pixels=[];
        for(let y=Math.ceil(b.y);y<b.y+b.height;y++)for(let x=Math.ceil(b.x);x<b.x+b.width;x++){
          pixels.push([...context.getImageData(x,y,1,1).data]);
        }
        return {pixels,ink:color(getComputedStyle(text).fill)};
      });
      return {pixels,background,texts,expected:color(getComputedStyle(group).fill),text:color(getComputedStyle(note).fill),
        accents:[...svg.querySelectorAll('[data-sketch-accent]')].map(g=>g.dataset.sketchAccent),
        overlays:svg.querySelectorAll('[data-contrast-ink]').length,maskCount:svg.querySelectorAll('mask').length};
    })()`);
    assert.ok(contrast(colors.text, colors.expected) >= 4.5, `${profile}/${theme}: quiet child text`);
    assert.deepEqual(colors.background, colors.expected, 'Contrast treatment recolors ink, not the panel beneath it.');
    assert.ok(Math.max(...colors.pixels.map(pixel=>contrast(pixel,colors.background))) >= 3, `${profile}/${theme}: captured connector`);
    assert.equal(colors.overlays, 1);
    assert.equal(colors.maskCount, 0);
    assert.equal(new Set(colors.accents).size, 1, 'The explicit group profile reaches descendants and the source-derived connector.');
    for (const text of colors.texts) {
      assert.ok(contrast(text.ink, colors.expected) >= 4.5, `${profile}/${theme}: group and quiet descendant text`);
      assert.ok(Math.max(...text.pixels.map(pixel => contrast(pixel, colors.expected))) >= 4.5,
        `${profile}/${theme}: captured group and quiet descendant text`);
    }
    if (profile === 'red') t.diagnostic(`${theme} red filled group: quiet text ${contrast(colors.text, colors.expected).toFixed(2)}:1, captured text ${Math.min(...colors.texts.map(text => Math.max(...text.pixels.map(pixel => contrast(pixel, colors.expected))))).toFixed(2)}:1, captured connector ${Math.max(...colors.pixels.map(pixel => contrast(pixel, colors.background))).toFixed(2)}:1`);
    await evidence(browser, `filled-${profile}-${theme}`, colors);
  }
  assert.deepEqual(browser.exceptions, []);
});

test('red is explicit only and named node/connector profiles preserve the four-accent v1/v2 cycle', { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const browser = await fixture(t);
  const input = { schemaVersion: 'sketch/v2', id: 'profile-cycle', title: 'Profiles',
    boxes: Array.from({ length: 8 }, (_, i) => ({ id: `node-${i}`, label: `Node ${i}`, x: i * 14, y: 0, w: 12, h: 6 })),
    connections: [{ id: 'link', from: 'node-0', to: 'node-1' }] };
  const accents = () => browser.evaluate(`(()=>{
    const svg=document.querySelector('#mount svg');
    return {nodes:[...svg.querySelectorAll('[data-sketch-box]')].map(g=>g.dataset.sketchAccent),
      edges:[...svg.querySelectorAll('[data-sketch-connection]')].map(g=>g.dataset.sketchAccent)};
  })()`);
  for (const schemaVersion of ['sketch/v1', 'sketch/v2']) {
    await browser.evaluate(`values.set('cycle',${JSON.stringify({ ...input, schemaVersion })});show('cycle',1000)`);
    assert.deepEqual(await accents(), { nodes: ['1', '2', '3', '4', '1', '2', '3', '4'], edges: ['1'] });
  }
  for (const [index, profile] of SKETCH_PROFILES.entries()) {
    const named = structuredClone(input);
    named.boxes[0].appearance = { profile };
    await browser.evaluate(`values.set('named',${JSON.stringify(named)});show('named',1000)`);
    const expected = ['neutral', '1', '2', '3', '4', 'red'][index];
    assert.deepEqual(await accents(), { nodes: [expected, '2', '3', '4', '1', '2', '3', '4'], edges: [expected] },
      `${profile}: explicit source and inherited connector share the same mapping without shifting other roots`);
    named.boxes[0].appearance = { profile: 'blue' };
    named.connections[0].appearance = { profile };
    await browser.evaluate(`values.set('named',${JSON.stringify(named)});show('named',1000)`);
    assert.deepEqual(await accents(), { nodes: ['2', '2', '3', '4', '1', '2', '3', '4'], edges: [expected] },
      `${profile}: connector selection overrides the source profile through the same catalog`);
    assert.equal(await browser.evaluate("JSON.stringify(values.get('named'))"), JSON.stringify(named));
  }
  assert.deepEqual(browser.exceptions, []);
});

test('explicit red treatments and connector ink retain browser and captured contrast in light/dark', { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const browser = await fixture(t);
  const input = { schemaVersion: 'sketch/v2', id: 'red-treatments', title: 'Explicit red',
    boxes: SKETCH_TREATMENTS.map((treatment, i) => ({
      id: treatment, label: 'Red title', caption: 'Caption', body: 'Body text', x: i * 24, y: 0, w: 20, h: 10,
      appearance: { profile: 'red', treatment },
    })),
    connections: SKETCH_TREATMENTS.slice(1).map((treatment, i) => ({
      id: `link-${i}`, from: SKETCH_TREATMENTS[i], to: treatment, label: 'Link', arrowheads: 'both', appearance: { profile: 'red' },
    })) };
  for (const theme of ['light', 'dark']) {
    await browser.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await browser.evaluate(`values.set('red',${JSON.stringify(input)});show('red',1000)`);
    await new Promise(done => setTimeout(done, 60));
    const result = await browser.evaluate(`(async()=>{
      const {captureAnnotatedDiagram}=await import('/annotation-capture.js');
      const svg=document.querySelector('#mount svg'),r=svg.getBoundingClientRect();
      const c=document.createElement('canvas'),ctx=c.getContext('2d');
      const image=await createImageBitmap(await captureAnnotatedDiagram(svg,{x:0,y:0,width:r.width,height:r.height},[]));
      c.width=image.width;c.height=image.height;ctx.drawImage(image,0,0);
      const sample=(x,y)=>[...ctx.getImageData(Math.floor(x),Math.floor(y),1,1).data];
      const probe=document.createElement('canvas').getContext('2d');
      const color=value=>{probe.clearRect(0,0,1,1);probe.fillStyle=value;probe.fillRect(0,0,1,1);return [...probe.getImageData(0,0,1,1).data]};
      const surface=color(getComputedStyle(svg).backgroundColor);
      const textResult=(text,background)=>{
        const b=text.getBBox(),pixels=[];
        for(let y=Math.ceil(b.y);y<b.y+b.height;y++)for(let x=Math.ceil(b.x);x<b.x+b.width;x++)pixels.push(sample(x,y));
        return {ink:color(getComputedStyle(text).fill),background,pixels};
      };
      return {
        nodes:[...svg.querySelectorAll('[data-sketch-box]')].map(g=>{
          const fill=getComputedStyle(g.querySelector('.sketch-box')).fill;
          const background=fill==='none'?surface:color(fill);
          return {id:g.dataset.sketchBox,accent:g.dataset.sketchAccent,
            texts:[...g.querySelectorAll('text')].map(text=>textResult(text,background))};
        }),
        edges:[...svg.querySelectorAll('[data-sketch-connection]')].map(g=>{
          const path=g.querySelector('path'),p=path.getPointAtLength(path.getTotalLength()/2);
          return {accent:g.dataset.sketchAccent,ink:color(getComputedStyle(path).stroke),background:surface,
            pixels:[-1,0,1].flatMap(dx=>[-1,0,1].map(dy=>sample(p.x+dx,p.y+dy))),
            arrows:[...g.querySelectorAll('polygon')].map(arrow=>color(getComputedStyle(arrow).fill)),
            text:textResult(g.querySelector('text'),color(getComputedStyle(g.querySelector('rect')).fill))};
        }),width:image.width,height:image.height};
    })()`);
    const textRatios = [], lineRatios = [];
    for (const node of result.nodes) {
      assert.equal(node.accent, 'red');
      assert.equal(node.texts.length, 3);
      for (const text of node.texts) {
        const ratio = contrast(text.ink, text.background);
        textRatios.push(ratio);
        assert.ok(ratio >= 4.5, `${theme}/${node.id}: browser text contrast ${ratio}`);
        assert.ok(Math.max(...text.pixels.map(pixel => contrast(pixel, text.background))) >= 4.5,
          `${theme}/${node.id}: captured text contrast`);
      }
    }
    for (const edge of result.edges) {
      assert.equal(edge.accent, 'red');
      assert.ok(contrast(edge.ink, edge.background) >= 3, `${theme}: browser connector contrast`);
      assert.equal(edge.arrows.length, 2);
      for (const ink of edge.arrows) assert.ok(contrast(ink, edge.background) >= 3, `${theme}: arrowhead contrast`);
      const ratio = Math.max(...edge.pixels.map(pixel => contrast(pixel, edge.background)));
      lineRatios.push(ratio);
      assert.ok(ratio >= 3, `${theme}: captured connector contrast ${ratio}`);
      assert.ok(contrast(edge.text.ink, edge.text.background) >= 4.5, `${theme}: connector label contrast`);
      assert.ok(Math.max(...edge.text.pixels.map(pixel => contrast(pixel, edge.text.background))) >= 4.5,
        `${theme}: captured connector label contrast`);
    }
    assert.equal(await browser.evaluate("JSON.stringify(values.get('red'))"), JSON.stringify(input));
    t.diagnostic(`${theme} red treatments: minimum text ${Math.min(...textRatios).toFixed(2)}:1, captured connector ${Math.min(...lineRatios).toFixed(2)}:1`);
    await evidence(browser, `red-treatments-${theme}`, result);
  }
  assert.deepEqual(browser.exceptions, []);
});

function clearGeometry(measurement) {
  for (const box of measurement.boxes) {
    assert.ok(box.font >= 14);
    assert.ok(box.text.x >= box.x + 5 && box.text.x + box.text.w <= box.x + box.w - 5, JSON.stringify(box));
    assert.ok(box.text.y >= box.y + 3 && box.text.y + box.text.h <= box.y + box.h - 3, JSON.stringify(box));
    if (box.container) assert.ok(box.text.y + box.text.h <= box.y + HEADER_HEIGHT * measurement.scaleY - 3, JSON.stringify(box));
  }
  for (const edge of measurement.edges) {
    assert.deepEqual(edge.points[0], edge.end);
    if (edge.text) {
      assert.ok(edge.font >= 12);
      assert.ok(edge.text.x >= edge.rect.x + 1 && edge.text.x + edge.text.w <= edge.rect.x + edge.rect.w - 1, JSON.stringify(edge));
      assert.ok(edge.text.y >= edge.rect.y && edge.text.y + edge.text.h <= edge.rect.y + edge.rect.h, JSON.stringify(edge));
      for (const box of measurement.boxes) {
        const h=box.container?HEADER_HEIGHT*measurement.scaleY:box.h, r=edge.rect;
        assert.equal(r.x<box.x+box.w && r.x+r.w>box.x && r.y<box.y+h && r.y+r.h>box.y,
          false,`${edge.id} label overlaps ${box.id}'s content`);
      }
    }
    const commands = edge.d.match(/[MLC][^MLC]+/g);
    const coordinates = commands.map(value=>value.slice(1).trim().split(/[\s,]+/).map(Number));
    const points = coordinates.map(value=>value.slice(-2));
    for (let i=1;i<points.length;i++) {
      if (commands[i].startsWith('M')) continue;
      const [x1,y1]=points[i-1], [x2,y2]=points[i];
      if (commands[i].startsWith('C')) {
        const xs=[x1,...coordinates[i].filter((_,index)=>index%2===0)];
        const ys=[y1,...coordinates[i].filter((_,index)=>index%2===1)];
        const r={x:Math.min(...xs),y:Math.min(...ys),right:Math.max(...xs),bottom:Math.max(...ys)};
        const obstacles=[...measurement.boxes.map(box=>({...box,h:box.container?HEADER_HEIGHT*measurement.scaleY:box.h})),
          ...measurement.edges.filter(item=>item.rect).map(item=>item.rect)];
        for (const box of obstacles) assert.equal(r.x<box.x+box.w&&r.right>box.x&&r.y<box.y+box.h&&r.bottom>box.y,
          false,`${edge.id}: entire bridge curve clears box/header/label bounds`);
        continue;
      }
      assert.ok(x1===x2 || y1===y2);
      for (const box of measurement.boxes.filter(({container})=>!container)) {
        const hit=x1===x2 ? x1>box.x+.01&&x1<box.x+box.w-.01&&Math.max(y1,y2)>box.y+.01&&Math.min(y1,y2)<box.y+box.h-.01
          : y1>box.y+.01&&y1<box.y+box.h-.01&&Math.max(x1,x2)>box.x+.01&&Math.min(x1,x2)<box.x+box.w-.01;
        assert.equal(hit,false,`${edge.id} crosses ${box.id}`);
      }
      if (edge.rect) {
        const r=edge.rect;
        const hit=x1===x2 ? x1>r.x&&x1<r.x+r.w&&Math.max(y1,y2)>r.y&&Math.min(y1,y2)<r.y+r.h
          : y1>r.y&&y1<r.y+r.h&&Math.max(x1,x2)>r.x&&Math.min(x1,x2)<r.x+r.w;
        assert.equal(hit,false,`${edge.id} label overlaps its route`);
      }
      for (const other of measurement.edges.filter(item=>item.rect && item.id!==edge.id)) {
        const r=other.rect;
        const hit=x1===x2 ? x1>r.x&&x1<r.x+r.w&&Math.max(y1,y2)>r.y&&Math.min(y1,y2)<r.y+r.h
          : y1>r.y&&y1<r.y+r.h&&Math.max(x1,x2)>r.x&&Math.min(x1,x2)<r.x+r.w;
        assert.equal(hit,false,`${edge.id} crosses ${other.id}'s label`);
      }
    }
  }
  assert.equal(measurement.width, measurement.viewBox[0], 'Capture pixels and SVG viewBox units stay 1:1.');
  assert.equal(measurement.height, measurement.viewBox[1]);
  assert.ok(measurement.page <= measurement.viewport);
}

test('compact presentation fits the main viewport with readable cards and clear projected geometry', { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const browser = await fixture(t);
  for (const theme of ['light','dark']) {
    await browser.call('Emulation.setEmulatedMedia', { features:[{name:'prefers-color-scheme',value:theme}] });
    for (const id of ['workflow','architecture','ui']) {
      await browser.evaluate(`show('${id}',780)`);
      await new Promise(done=>setTimeout(done,100));
      const result=await measure(browser); clearGeometry(result);
      assert.equal(result.title,null, 'Document naming must not create a floating native SVG title tooltip.');
      assert.ok(result.accessibleName);
      assert.ok(result.width <= result.client + 1, `${id}: fits a main-sized pane at readable type sizes`);
      if (id==='workflow') {
        assert.ok(result.boxes.find(b=>b.id==='requester').w < 300);
        assert.ok(result.boxes.find(b=>b.id==='prepare').h <= 80);
      }
      await evidence(browser, `${id}-${theme}-main`, result);
    }
  }
  for (const width of [543,320]) {
    await browser.call('Emulation.setDeviceMetricsOverride', { width, height:800, deviceScaleFactor:1, mobile:false });
    await browser.evaluate(`show('workflow',${width})`);
    await new Promise(done=>setTimeout(done,100));
    const result=await measure(browser); clearGeometry(result);
    assert.ok(result.scroll > result.client, 'Very narrow panes pan instead of making labels unreadable.');
    await evidence(browser, `workflow-dark-${width}`, result);
  }
  assert.deepEqual(browser.exceptions,[]);
});

test('merged continuous bridges and transparent underpasses preserve light/dark capture and compact fanout', { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const browser = await fixture(t);
  await browser.evaluate(`values.set('fanout',${JSON.stringify(fanoutCrossingSketch)});show('fanout',500)`);
  for (const theme of ['light', 'dark']) {
    await browser.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await new Promise(done => setTimeout(done, 100));
    const measurement = await measure(browser);
    clearGeometry(measurement);
    const result = await browser.evaluate(`(async()=>{
      const {captureAnnotatedDiagram}=await import('/annotation-capture.js');
      const svg=document.querySelector('#mount svg'),path=svg.querySelector('[data-sketch-connection="e-trace"] path');
      const d=path.getAttribute('d'),gaps=[];
      for(const under of svg.querySelectorAll('path[data-crossing-gaps="1"]')){
        const commands=under.getAttribute('d').match(/[ML][^ML]+/g);
        for(let i=1;i<commands.length;i++)if(commands[i].startsWith('M')){
          const start=commands[i-1].slice(1).split(',').map(Number),end=commands[i].slice(1).split(',').map(Number);
          gaps.push({x:(start[0]+end[0])/2,y:start[1],half:Math.abs(end[0]-start[0])/2});
        }
      }
      const bounds=svg.getBoundingClientRect();
      const blob=await captureAnnotatedDiagram(svg,{x:0,y:0,width:bounds.width,height:bounds.height},[]);
      const image=await createImageBitmap(blob),canvas=document.createElement('canvas');
      canvas.width=image.width;canvas.height=image.height;
      const context=canvas.getContext('2d');context.drawImage(image,0,0);
      const sample=(x,y)=>[...context.getImageData(Math.floor(x),Math.floor(y),1,1).data];
      const pixels=gaps.map(p=>({gap:sample(p.x+p.half*.7,p.y),background:sample(p.x+p.half*.7,p.y+8),
        over:sample(p.x,p.y),under:sample(p.x+p.half+3,p.y)}));
      const store=svg.querySelector('[data-sketch-connection="c-store"] path').getAttribute('d');
      return {count:Number(path.dataset.crossingBridges),moves:(d.match(/M/g)||[]).length,curves:(d.match(/C/g)||[]).length,gaps,pixels,
        storeYs:[...new Set(store.match(/[ML][^ML]+/g).map(command=>Number(command.slice(1).split(',')[1])))],
        masks:svg.querySelectorAll('mask,clipPath').length,
        connectionRects:svg.querySelectorAll('[data-sketch-connection] rect').length};
    })()`);
    assert.equal(result.count, 1);
    assert.equal(result.moves, 1, 'The vertical Audit-to-Trace path is one continuous stroke.');
    assert.equal(result.curves, 2, 'One shared bowed bridge has two smooth shoulders.');
    assert.equal(result.gaps.length, 3);
    assert.equal(result.masks, 0);
    assert.equal(result.connectionRects, 0, 'No white or background-colored patches hide the parent tint.');
    assert.equal(result.storeYs.length, 1, 'The displayed Store handoff stays horizontal through its underpass to the arrow tip.');
    for (const pixels of result.pixels) {
      assert.deepEqual(pixels.gap, pixels.background, `${theme}: the capture preserves the actual tinted panel through the gap`);
      assert.notDeepEqual(pixels.over, pixels.background, 'The continuous vertical bridge remains visible above the underpass.');
      assert.notDeepEqual(pixels.under, pixels.background, 'The horizontal route continues on the other side.');
    }
    await evidence(browser, `fanout-crossings-${theme}`, { measurement, result });
  }
  const dashed = { ...fanoutCrossingSketch, schemaVersion: 'sketch/v2',
    connections: fanoutCrossingSketch.connections.map(edge => ({ ...edge, stroke: 'dashed' })) };
  await browser.evaluate(`values.set('dashed-v2',${JSON.stringify(dashed)});show('dashed-v2',500)`);
  await new Promise(done=>setTimeout(done,100));
  clearGeometry(await measure(browser));
  const dashedBridge = await browser.evaluate(`(()=>{
    const g=document.querySelector('[data-sketch-connection="e-trace"]'),over=g.querySelector('[data-bridge-overpass]');
    return {dash:g.querySelector('path').getAttribute('stroke-dasharray'),
      overlays:g.querySelectorAll('[data-bridge-overpass]').length,overlayDash:over?.getAttribute('stroke-dasharray'),
      moves:over?.getAttribute('d').match(/M/g).length};
  })()`);
  assert.ok(dashedBridge.dash);
  assert.equal(dashedBridge.overlays, 1);
  assert.equal(dashedBridge.overlayDash, null, 'A dashed relationship still has an unambiguous continuous overpass.');
  assert.equal(dashedBridge.moves, 1);
  await browser.evaluate(`(()=>{const g=document.querySelector('[data-sketch-connection="e-trace"]');
    g.focus();g.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  assert.equal(await browser.evaluate('selections.at(-1).id'), 'e-trace');
  await browser.evaluate("document.querySelector('[data-sketch-view-action=in]').click()");
  clearGeometry(await measure(browser));
  assert.equal(await browser.evaluate("document.querySelector('[data-sketch-connection=\"e-trace\"] path').dataset.crossingBridges"), '1');
  assert.deepEqual(browser.exceptions, []);
});

test('local zoom preserves layout data while a captured sketch remains independent of the live view', { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const browser=await fixture(t);
  const original=await browser.evaluate("JSON.stringify(api.layoutSketch(values.get('workflow')))");
  await browser.evaluate("document.querySelector('[data-sketch-view-action=in]').click()");
  const zoomed=await measure(browser); clearGeometry(zoomed);
  assert.ok(zoomed.boxes[0].font > 14);
  await browser.evaluate("document.querySelector('[data-sketch-view-action=fit]').click()");
  await browser.evaluate(`(()=>{
    const $=id=>document.getElementById(id);
    window.annotation=api.createAnnotationController({panel:$('panel'),artifactMode:true,
      getView:()=>({artifactId:'workflow-example',revisionId:'revision',designDigest:'a'.repeat(64)}),
      selectArtifact:()=>{},getArtifactLabel:()=> 'Workflow',
      getCandidates:()=>[{element:$('mount').querySelector('svg'),label:'Workflow',identity:{
        schemaVersion:'artifact-annotation/v1',artifactId:'workflow-example',revisionId:'revision',designDigest:'a'.repeat(64),selectionId:null}}],
      controls:{tools:$('annotation-tools'),parking:$('parking'),reset:$('annotation-reset'),capture:$('capture'),
        status:$('annotation-status'),preview:$('preview'),image:$('image'),caption:$('caption'),remove:$('remove')}});
    $('annotate').onclick=()=>annotation.toggleArtifact('workflow-example');
    annotation.refresh(); $('annotate').click();
  })()`);
  await browser.waitFor("document.querySelector('.annotation-editor').open && !annotation.isCapturing()");
  const pinned=await browser.evaluate("document.querySelector('.annotation-editor-base').src");
  await browser.evaluate(`(async()=>{
    const svg=document.querySelector('#mount svg'),box=svg.querySelector('[data-sketch-box="prepare"] rect');
    const r=box.getBoundingClientRect(),{visibleDiagramRegion}=await import('/annotation-controller.js');
    const s=visibleDiagramRegion(svg,document.querySelector('#panel'));
    const swatch=document.createElement('canvas'),c=swatch.getContext('2d');c.fillStyle=getComputedStyle(box).fill;c.fillRect(0,0,1,1);
    globalThis.cardSample={x:Math.floor(r.x-s.left+12),y:Math.floor(r.y-s.top+12),color:[...c.getImageData(0,0,1,1).data]};
  })()`);
  await browser.evaluate("document.querySelector('[data-sketch-view-action=in]').dispatchEvent(new Event('click'));");
  assert.equal(await browser.evaluate("document.querySelector('.annotation-editor-base').src"),pinned);
  await browser.evaluate("document.querySelector('#panel').style.width='650px'");
  await new Promise(done=>setTimeout(done,100));
  assert.equal(await browser.evaluate("document.querySelector('.annotation-editor-base').src"),pinned,'Resize must not remap a captured drawing.');
  await browser.evaluate("document.querySelector('#panel').style.width='780px'; show('workflow',780)");
  assert.equal(await browser.evaluate("document.querySelector('.annotation-editor-base').src"),pinned,'Remount does not recapture the saved bitmap.');
  const point=await browser.evaluate("(()=>{const c=document.querySelector('.annotation-editor-ink'),r=c.getBoundingClientRect();return{x:r.x,y:r.y,sx:r.width/c.width,sy:r.height/c.height}})()");
  await browser.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,x:point.x+30.5*point.sx,y:point.y+40.5*point.sy});
  await browser.call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:point.x+70.5*point.sx,y:point.y+40.5*point.sy});
  await browser.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,x:point.x+70.5*point.sx,y:point.y+40.5*point.sy});
  await browser.evaluate("document.querySelector('[data-annotation-action=attach]').click()");
  await browser.waitFor("!!annotation.preview()");
  const pixels=await browser.evaluate(`(async()=>{const p=annotation.preview(),image=await createImageBitmap(p.blob),c=document.createElement('canvas');
    c.width=image.width;c.height=image.height;const context=c.getContext('2d');context.drawImage(image,0,0);
    return {width:image.width,height:image.height,source:p.source,pixel:[...context.getImageData(50,40,1,1).data],
      cardPixel:[...context.getImageData(cardSample.x,cardSample.y,1,1).data],expectedCardPixel:cardSample.color};})()`);
  assert.deepEqual(pixels.pixel,[228,93,52,255]);
  assert.equal(pixels.width,pixels.source.viewport.width); assert.equal(pixels.height,pixels.source.viewport.height);
  assert.deepEqual(pixels.cardPixel,pixels.expectedCardPixel,'The captured diagram aligns with displayed card geometry and color.');
  await browser.evaluate("document.querySelector('#remove').click()");
  assert.equal(await browser.evaluate("document.querySelector('[data-sketch-view-action=in]').disabled"),false,'The static editor never locks the live renderer.');
  await browser.waitFor("!document.querySelector('[data-sketch-view-action=in]').disabled");
  await browser.evaluate("document.querySelector('[data-sketch-view-action=in]').click()");
  clearGeometry(await measure(browser));
  assert.equal(await browser.evaluate("JSON.stringify(api.layoutSketch(values.get('workflow')))"),original);
  await evidence(browser,'annotation-zoom',await measure(browser));
  assert.deepEqual(browser.exceptions,[]);
});

test('accepted long labels and bidirectional routes remain readable after presentation compaction', { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const browser=await fixture(t);
  await browser.evaluate(`(()=>{
    const value=api.createTemplate('workflow');
    value.boxes.find(b=>b.id==='requester').label='First readable line\\nSecond readable line';
    value.boxes.find(b=>b.id==='prepare').label='WWWWWWWWWWWW\\nWWWWWWWWWWWW\\nWWWWWWWWWWWW\\nWWWWWWWWWWWW';
    window.longInput=JSON.stringify(value); values.set('long',value); show('long',780);
  })()`);
  await new Promise(done=>setTimeout(done,100));
  clearGeometry(await measure(browser));
  assert.equal(await browser.evaluate("JSON.stringify(values.get('long'))"),await browser.evaluate('longInput'));
  await browser.evaluate(`(()=>{
    const value={schemaVersion:'sketch/v1',id:'bidirectional-view',title:'Two directions',
      boxes:[{id:'a',label:'One',x:0,y:0,w:10,h:5},{id:'b',label:'Two',x:20,y:0,w:10,h:5}],
      connections:[{id:'forward',from:'a',to:'b',label:'Request'},{id:'backward',from:'b',to:'a',label:'Reply'}]};
    values.set('bidirectional',value);show('bidirectional',600);
  })()`);
  await new Promise(done=>setTimeout(done,100));
  const result=await measure(browser);clearGeometry(result);
  assert.equal(result.edges.length,2);
  assert.notDeepEqual(result.edges[0].points[0],result.edges[1].points[0]);
  assert.deepEqual(browser.exceptions,[]);
});

test('production artifact mounting retains the captured image while every live artifact remains adjustable', { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const browser=await fixture(t);
  await browser.evaluate(`(async()=>{
    const {createSharedDesignView}=await import('/renderers/shared-design.js');
    const panel=document.querySelector('#panel');
    panel.innerHTML='<div class="panel-heading">Production mount</div><div id="backbone-proposal"><nav id="tabs" class="design-navigation"></nav><div id="mount"></div></div><div id="parking" hidden><div id="annotation-tools" class="diagram-annotation-tools" hidden><button id="annotation-reset">Reset sketch</button><button id="capture">Capture</button><span id="annotation-status"></span></div></div>';
    const $=id=>document.getElementById(id); let annotations;
    const view=createSharedDesignView({tabs:$('tabs'),mount:$('mount'),onChange:()=>annotations?.refresh(),onAnnotate:id=>annotations.toggleArtifact(id)});
    annotations=api.createAnnotationController({panel,artifactMode:true,getView:()=>view.current(),selectArtifact:id=>view.selectArtifact(id),
      getArtifactLabel:id=>view.label(id),getCandidates:()=>view.candidates(),
      controls:{tools:$('annotation-tools'),parking:$('parking'),reset:$('annotation-reset'),capture:$('capture'),
        status:$('annotation-status'),preview:$('preview'),image:$('image'),caption:$('caption'),remove:$('remove')}});
    view.render({binding:{revisionId:'revision',digest:'a'.repeat(64)},content:{schemaVersion:'sketch-design/v1',
      goal:'Render the same data',summary:'Production mounting fixture',
      outcomes:[{id:'outcome',description:'Preserve the source and drawing',references:['workflow-example']}],
      artifacts:[api.createTemplate('workflow'),api.createTemplate('architecture')]}});
    window.productionView=view; window.productionAnnotations=annotations;
  })()`);
  await browser.waitFor("document.querySelector('.sketch-view-status').textContent === 'Fit'");
  await browser.evaluate("document.querySelector('[data-sketch-view-action=in]').click();document.querySelector('[data-annotate-artifact]').click()");
  await browser.waitFor("document.querySelector('.annotation-editor').open && !productionAnnotations.isCapturing()");
  const pinned=await browser.evaluate("document.querySelector('.annotation-editor-base').src");
  await browser.evaluate("document.querySelector('[data-annotation-action=close]').click()");
  await browser.evaluate("productionView.selectArtifact('architecture-example')");
  await browser.waitFor("!document.querySelector('[data-sketch-view-action=in]').disabled");
  await browser.evaluate("document.querySelector('[data-sketch-view-action=in]').click();productionView.selectArtifact('workflow-example')");
  await browser.evaluate("document.querySelector('[data-annotate-artifact]').click()");
  assert.equal(await browser.evaluate("document.querySelector('.annotation-editor-base').src"),pinned);
  await browser.evaluate("document.querySelector('[data-annotation-action=close]').click()");
  await browser.waitFor("!document.querySelector('[data-sketch-view-action=fit]').disabled");
  assert.deepEqual(browser.exceptions,[]);
});

test('containment alone distinguishes root groups, nested groups and leaves without recursive font or color reduction', { skip: !browserAvailable, timeout: 60_000 }, async t => {
  const browser=await fixture(t);
  await browser.evaluate(`(()=>{
    const value={schemaVersion:'sketch/v1',id:'containment-styles',title:'Containment style hierarchy',
      boxes:[
        {id:'root',label:'Root group',x:0,y:0,w:32,h:28},
        {id:'middle',label:'Nested group',parent:'root',x:2,y:4,w:26,h:21},
        {id:'inner',label:'Nested section',parent:'middle',x:2,y:4,w:20,h:13},
        {id:'leaf',label:'Leaf action',parent:'inner',x:2,y:4,w:16,h:5},
        {id:'standalone',label:'Standalone leaf',x:40,y:0,w:16,h:5}],
      connections:[{id:'result',from:'leaf',to:'standalone',label:'Result'}]};
    window.containmentOriginal=JSON.stringify(value);
    window.containmentLayout=JSON.stringify(api.layoutSketch(value));
    values.set('containment',value);show('containment',780);
  })()`);
  for(const [theme,surface,text,border] of [
    ['light','#f8fafc','#16202a','#718096'],['dark','#151c27','#e6edf3','#64748b'],
  ]) {
    await browser.evaluate(`(()=>{const root=document.documentElement;
      root.style.setProperty('--background-color-default','${surface}');
      root.style.setProperty('--text-color-default','${text}');
      root.style.setProperty('--border-color-default','${border}');})()`);
    await new Promise(done=>setTimeout(done,100));
    const geometry=await measure(browser);clearGeometry(geometry);
    const appearance=await browser.evaluate(`(()=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
      const color=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
      const result={surface:color(getComputedStyle(document.querySelector('.sketch-grid-surface')).fill),nodes:{}};
      for(const node of document.querySelectorAll('[data-sketch-box]')){
        const rect=node.querySelector('rect'),title=node.querySelector('text');
        result.nodes[node.dataset.sketchBox]={role:node.dataset.sketchPresentation,accent:node.dataset.sketchAccent,
          fill:color(getComputedStyle(rect).fill),text:color(getComputedStyle(title).fill),
          strokeWidth:parseFloat(getComputedStyle(rect).strokeWidth),
          font:parseFloat(getComputedStyle(title).fontSize),weight:Number(getComputedStyle(title).fontWeight),
          inset:title.getBBox().x-rect.getBBox().x};
      }return result;
    })()`);
    const {root,middle,inner,leaf,standalone}=appearance.nodes;
    assert.equal(root.role,'root-container');
    assert.equal(middle.role,'nested-container');assert.equal(inner.role,'nested-container');
    assert.equal(leaf.role,'leaf');assert.equal(standalone.role,'leaf');
    assert.equal(root.accent,middle.accent);assert.equal(root.accent,inner.accent);assert.equal(root.accent,leaf.accent);
    assert.notEqual(root.accent,standalone.accent);
    assert.deepEqual(middle.fill,inner.fill,'Nested levels share one light tint, not recursive darkening.');
    assert.deepEqual(leaf.fill,appearance.surface);assert.deepEqual(standalone.fill,appearance.surface);
    const distance=fill=>fill.slice(0,3).reduce((n,v,i)=>n+Math.abs(v-appearance.surface[i]),0);
    assert.ok(distance(root.fill)>distance(middle.fill) && distance(middle.fill)>0);
    const maxDelta=fill=>Math.max(...fill.slice(0,3).map((v,i)=>Math.abs(v-appearance.surface[i])));
    assert.ok(maxDelta(root.fill)>=18,'Root panels must be visibly separated from solid cards.');
    assert.ok(maxDelta(middle.fill)>=9,'Nested panels remain visible rather than a barely perceptible tint.');
    const luminance=rgb=>rgb.slice(0,3).map(v=>{const c=v/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;})
      .reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    for(const node of Object.values(appearance.nodes)){
      const a=luminance(node.text),b=luminance(node.fill);
      assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5);
    }
    assert.ok(root.weight>middle.weight);assert.equal(middle.weight,inner.weight);
    for(const node of Object.values(appearance.nodes))assert.equal(node.font,14);
    assert.ok(root.inset>middle.inset+2);assert.ok(leaf.strokeWidth>middle.strokeWidth);
    await evidence(browser,`containment-${theme}`,{geometry,appearance});
  }
  assert.equal(await browser.evaluate("JSON.stringify(values.get('containment'))"),await browser.evaluate('containmentOriginal'));
  assert.equal(await browser.evaluate("JSON.stringify(api.layoutSketch(values.get('containment')))"),await browser.evaluate('containmentLayout'));
  assert.deepEqual(browser.exceptions,[]);
});
