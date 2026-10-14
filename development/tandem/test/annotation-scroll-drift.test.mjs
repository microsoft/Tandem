import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname, join } from 'node:path';
import test from 'node:test';
import { openFixtureBrowser, browserAvailable } from './helpers/browser-fixture.mjs';

const root = resolve(import.meta.dirname, '../public');
// Exact published v2 model/binding from the reported Traffic Light Lab capture.
// No live endpoint, request history, or user-owned attachment is needed by tests.
const design = JSON.parse(await readFile(new URL('./fixtures/annotation-traffic-light.json', import.meta.url), 'utf8'));
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;font:14px system-ui;background:white;color:#17212b;overflow:hidden}
#outer{margin:19px 23px;width:1050px;height:775px;overflow:auto;overflow-anchor:none;border:3px solid #aaa}
#panel{margin:13px 17px;width:1006px;height:759px;overflow:auto;border:2px solid #aaa;box-sizing:border-box}
.panel-heading{position:sticky;top:0;background:white;z-index:1;height:22px}
.perspective-toolbar{display:flex;gap:6px;height:24px}
#annotation-tools{height:24px;display:flex}button{white-space:nowrap}
#status{position:fixed;bottom:0}[hidden]{display:none!important}
.diagram-annotation-overlay{position:fixed;z-index:10;touch-action:none}
.annotation-editor-stage{max-width:min(75vw,750px)!important}
.artifact-description{display:none}
#preview{position:fixed;right:0;bottom:0}#preview img{max-width:300px}
</style>
<div id="outer"><section id="panel"><div class="panel-heading">Scrolled annotation fixture</div>
<div id="backbone-proposal"><nav id="tabs"></nav><div id="mount"></div></div>
<div id="parking" hidden><div id="annotation-tools" hidden><button id="annotation-reset">Reset</button>
<button id="capture">Capture</button><span id="status"></span></div></div></section><div style="height:150px"></div></div>
<div id="preview" hidden><img id="image"><span id="caption"></span><button id="remove">Remove</button></div>`;

async function fixture(t, dpr = 1) {
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') { response.setHeader('content-type', 'text/html'); response.end(html); return; }
    const file = resolve(root, path.slice(1)), tail = relative(root, file);
    if (tail.startsWith('..') || isAbsolute(tail)) { response.writeHead(403).end(); return; }
    try {
      response.setHeader('content-type', extname(file) === '.js' ? 'text/javascript'
        : extname(file) === '.json' ? 'application/json' : 'text/plain');
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); });
  const browser = await openFixtureBrowser(t);
  await browser.call('Emulation.setDeviceMetricsOverride', { width: 1478, height: 814, deviceScaleFactor: dpr, mobile: false });
  await browser.call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await browser.waitFor("document.querySelector('#mount')");
  await browser.evaluate(`(async()=>{
    const {createSharedDesignView}=await import('/renderers/shared-design.js');
    const {createAnnotationController,visibleDiagramRegion}=await import('/annotation-controller.js');
    window.captureApi=await import('/annotation-capture.js');
    const $=id=>document.getElementById(id);
    window.region=()=>visibleDiagramRegion(document.querySelector('.shared-sketch svg'),$('panel'));
    window.view=createSharedDesignView({tabs:$('tabs'),mount:$('mount'),
      onChange:()=>window.annotation?.refresh(),onAnnotate:id=>annotation.toggleArtifact(id)});
    window.design=${JSON.stringify(design)};
    window.original=JSON.stringify(design);
    view.render(design);
    window.annotation=createAnnotationController({panel:$('panel'),artifactMode:true,
      getView:()=>view.current(),selectArtifact:id=>view.selectArtifact(id),
      getArtifactLabel:id=>view.label(id),getCandidates:()=>view.candidates(),
      controls:{parking:$('parking'),tools:$('annotation-tools'),status:$('status'),
        reset:$('annotation-reset'),capture:$('capture'),remove:$('remove'),
        image:$('image'),preview:$('preview'),caption:$('caption')}});
    await document.fonts.ready;
  })()`);
  await browser.waitFor("document.querySelector('.shared-sketch').dataset.viewMode === 'fit'");
  return browser;
}

async function prepare(browser, { scroll = 318, pan = 0, zoom = false, viewBox = false } = {}) {
  const measurement = await browser.evaluate(`(async()=>{
    ${zoom ? "document.querySelector('[data-sketch-view-action=\"in\"]').click();" : ''}
    const svg=document.querySelector('.shared-sketch svg');
    if (${viewBox}) {
      const box=svg.viewBox.baseVal;
      svg.setAttribute('viewBox',[23,17,box.width*1.08,box.height*1.08].join(' '));
    }
    view.inspectReference(design.binding,'traffic-simulator#green-light');
    document.querySelector('#outer').scrollTop=11;
    document.querySelector('#panel').scrollTop=${scroll};
    document.querySelector('.shared-sketch').scrollLeft=${pan};
    await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
    annotation.toggleArtifact('traffic-simulator');
    await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
    const r=region(),pixel=document.createElement('canvas').getContext('2d');
    window.lamps=['red-light','yellow-light','green-light'].map(id=>{
      const shape=svg.querySelector('[data-sketch-box="'+id+'"] .sketch-box'),b=shape.getBoundingClientRect();
      pixel.fillStyle=getComputedStyle(shape).fill;pixel.fillRect(0,0,1,1);
      return {id,x:b.left-r.left,y:b.top-r.top,width:b.width,height:b.height,
        fill:[...pixel.getImageData(0,0,1,1).data].slice(0,3)};
    });
    window.contour={
      left:Math.min(...lamps.map(l=>l.x))-12,right:Math.max(...lamps.map(l=>l.x+l.width))+12,
      top:Math.min(...lamps.map(l=>l.y))-12,bottom:Math.max(...lamps.map(l=>l.y+l.height))+12};
    return {region:r,lamps,contour,viewBox:svg.getAttribute('viewBox'),
      matrix:[svg.getScreenCTM().a,svg.getScreenCTM().d],pan:svg.parentElement.scrollLeft};
  })()`);
  await browser.waitFor("document.querySelector('.annotation-editor').open && !annotation.isCapturing()");
  measurement.editor = await browser.evaluate("document.querySelector('.annotation-editor-ink').getBoundingClientRect().toJSON()");
  return measurement;
}

async function draw(browser, measurement) {
  const { region: r, contour: c, editor } = measurement;
  const screen = (x,y) => ({ x:editor.left+x*editor.width/r.width,y:editor.top+y*editor.height/r.height });
  for (const [index, [x, y]] of [[c.left,c.top],[c.right,c.top],[c.right,c.bottom],[c.left,c.bottom],[c.left,c.top]].entries()) {
    await browser.call('Input.dispatchMouseEvent', {
      type: index === 0 ? 'mousePressed' : 'mouseMoved', ...screen(x,y),
      button: 'left', buttons: 1, clickCount: index === 0 ? 1 : 0,
    });
  }
  await browser.call('Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...screen(c.left,c.top), button: 'left', buttons: 0, clickCount: 1,
  });
}

async function capture(browser) {
  await browser.evaluate("if(!document.querySelector('.annotation-editor').open)annotation.toggleArtifact('traffic-simulator');document.querySelector('[data-annotation-action=attach]').click()");
  await browser.waitFor("annotation.preview() && !annotation.isCapturing()");
  return browser.evaluate(`(async()=>{
    const preview=annotation.preview(),image=new Image();image.src=preview.url;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    canvas.getContext('2d').drawImage(image,0,0);
    return {source:preview.source,data:canvas.toDataURL().split(',')[1],width:image.width,height:image.height};
  })()`);
}

async function alignment(browser, captured, native, measurement) {
  return browser.evaluate(`(async()=>{
    const r=${JSON.stringify(measurement.region)},editor=${JSON.stringify(measurement.editor)},lamps=${JSON.stringify(measurement.lamps)};
    async function inspect(data,native) {
      const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=r.width;canvas.height=r.height;
      const c=canvas.getContext('2d');
      if(native)c.drawImage(image,-editor.left*r.width/editor.width,-editor.top*r.height/editor.height,
        innerWidth*r.width/editor.width,innerHeight*r.height/editor.height);
      else c.drawImage(image,0,0);
      const pixels=c.getImageData(0,0,canvas.width,canvas.height).data;
      function scan(rect,color) {
        let count=0,sumX=0,sumY=0,left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
        for(let y=Math.max(0,Math.floor(rect.y));y<Math.min(canvas.height,Math.ceil(rect.y+rect.height));y++)
          for(let x=Math.max(0,Math.floor(rect.x));x<Math.min(canvas.width,Math.ceil(rect.x+rect.width));x++){
            const i=(y*canvas.width+x)*4;
            if(color.every((value,k)=>Math.abs(value-pixels[i+k])<18)){
              count++;sumX+=x;sumY+=y;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
            }
          }
        return {count,x:sumX/count,y:sumY/count,left,right,top,bottom};
      }
      return {lamps:lamps.map(l=>({id:l.id,...scan({x:l.x-4,y:l.y-4,width:l.width+8,height:l.height+8},l.fill)})),
        contour:scan({x:0,y:0,width:r.width,height:r.height},[228,93,52])};
    }
    return {native:await inspect(${JSON.stringify(native.toString('base64'))},true),
      captured:await inspect(${JSON.stringify(captured.data)},false)};
  })()`);
}

for (const config of [
  { name:'reported-crop', dpr:1 },
  { name:'panned-zoom', dpr:2, scroll:430, pan:77, zoom:true },
  { name:'svg-viewbox', dpr:1.5, scroll:318, pan:33, viewBox:true },
]) test(`Traffic Light Lab scroll/draw/PNG pixel alignment: ${config.name}`, {skip:!browserAvailable,timeout:60_000}, async t=>{
  const browser=await fixture(t,config.dpr),measurement=await prepare(browser,config);
  assert.ok(measurement.region.viewport.y>0);
  assert.equal(measurement.pan,config.pan??0);
  assert.equal(measurement.region.viewport.scale,1);
  for(const lamp of measurement.lamps) {
    assert.ok(lamp.y>12 && lamp.y+lamp.height+12<measurement.region.height,`${lamp.id} must be visible`);
  }
  await draw(browser,measurement);
  const native=await browser.screenshot(),captured=await capture(browser);
  assert.deepEqual(captured.source,{
    schemaVersion:'artifact-annotation/v1',artifactId:'traffic-simulator',
    revisionId:design.binding.revisionId,designDigest:design.binding.digest,selectionId:'green-light',
    viewport:measurement.region.viewport,
  });
  assert.equal(captured.width,measurement.region.width);
  assert.equal(captured.height,measurement.region.height);
  const metrics=await alignment(browser,captured,native,measurement);
  if(process.env.TANDEM_BROWSER_ARTIFACTS) {
    await mkdir(process.env.TANDEM_BROWSER_ARTIFACTS,{recursive:true});
    await writeFile(join(process.env.TANDEM_BROWSER_ARTIFACTS,`${config.name}-native.png`),native);
    await writeFile(join(process.env.TANDEM_BROWSER_ARTIFACTS,`${config.name}-captured.png`),Buffer.from(captured.data,'base64'));
    await writeFile(join(process.env.TANDEM_BROWSER_ARTIFACTS,`${config.name}-alignment.json`),JSON.stringify({measurement,metrics,source:captured.source},null,2));
  }
  for(let i=0;i<metrics.native.lamps.length;i++) {
    const live=metrics.native.lamps[i],png=metrics.captured.lamps[i];
    assert.ok(live.count>300 && png.count>live.count*.9,`Same ${live.id} fill was lost: ${JSON.stringify(metrics)}`);
    for(const coordinate of ['x','y','left','right','top','bottom'])
      assert.ok(Math.abs(png[coordinate]-live[coordinate])<=1.5,`${live.id} ${coordinate} drift: ${JSON.stringify(metrics)}`);
  }
  for(const edge of ['left','right','top','bottom']) {
    assert.ok(Math.abs(metrics.captured.contour[edge]-metrics.native.contour[edge])<=1,`Contour ${edge} drift`);
  }
  const liveGap=metrics.native.contour.bottom-metrics.native.lamps[2].bottom;
  const pngGap=metrics.captured.contour.bottom-metrics.captured.lamps[2].bottom;
  assert.ok(pngGap>8 && Math.abs(pngGap-liveGap)<=1.5,'Contour must still enclose Green in the PNG');
  assert.equal(await browser.evaluate('JSON.stringify(design)===original'),true);
  await browser.call('Browser.close');
});

test('captured strokes survive live remount, scroll, resize, SVG mapping and revision changes without rebinding', {
  skip:!browserAvailable,timeout:60_000,
},async t=>{
  const browser=await fixture(t),measurement=await prepare(browser);
  await draw(browser,measurement);
  await browser.evaluate("document.querySelector('[data-annotation-action=close]').click()");
  const result=await browser.evaluate(`(async()=>{
    const panel=document.getElementById('panel'),svg=document.querySelector('.shared-sketch svg');
    const outer=document.getElementById('outer'),outerScroll=outer.scrollTop;
    const old=svg.getAttribute('viewBox'),width=svg.getAttribute('width'),scroll=panel.scrollTop;
    annotation.toggleArtifact('traffic-simulator');
    const before=document.querySelector('.annotation-editor-ink').toDataURL();
    const retained=()=>{annotation.refresh();return !document.querySelector('[data-annotation-action=attach]').disabled
      && document.querySelector('.annotation-editor-ink').toDataURL()===before};
    panel.scrollTop+=30;const scrolled=retained();panel.scrollTop=scroll;
    svg.setAttribute('viewBox','0 0 1200 1200');const changedMapping=retained();svg.setAttribute('viewBox',old);
    svg.setAttribute('width',String(Number(width)+20));const resized=retained();svg.setAttribute('width',width);
    svg.replaceWith(svg.cloneNode(true));outer.scrollTop=outerScroll;panel.scrollTop=scroll;
    const remounted=retained();
    return {scrolled,changedMapping,resized,remounted,unchanged:JSON.stringify(design)===original};
  })()`);
  assert.deepEqual(result,{scrolled:true,changedMapping:true,resized:true,remounted:true,unchanged:true});
  await browser.evaluate(`(()=>{
    const encode=HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob=function(callback,...args){
      HTMLCanvasElement.prototype.toBlob=encode;
      encode.call(this,blob=>{window.finishCapture=()=>callback(blob)},...args);
    };
    document.querySelector('[data-annotation-action=attach]').click();
  })()`);
  await browser.waitFor('typeof finishCapture==="function"');
  await browser.evaluate(`(()=>{
    document.querySelector('.shared-sketch svg').setAttribute('viewBox','0 0 1200 1200');
    const next=structuredClone(design);next.binding.revisionId='changed-revision';next.binding.digest='changed-digest';
    view.render(next);annotation.refresh();
    finishCapture();
  })()`);
  await browser.waitFor('!annotation.isCapturing()');
  assert.deepEqual(await browser.evaluate('annotation.preview().source'),{
    schemaVersion:'artifact-annotation/v1',artifactId:'traffic-simulator',
    revisionId:design.binding.revisionId,designDigest:design.binding.digest,selectionId:'green-light',viewport:measurement.region.viewport,
  },
    'Live mapping changes during static export cannot rebind its source');
  assert.equal(await browser.evaluate(`(()=>{
    const canvas=document.querySelector('.annotation-editor-ink');
    return !document.querySelector('.annotation-editor').open
      && !canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.some((value,index)=>index%4===3&&value)
      && annotation.preview().source.revisionId===design.binding.revisionId;
  })()`),true);
  await browser.call('Browser.close');
});
