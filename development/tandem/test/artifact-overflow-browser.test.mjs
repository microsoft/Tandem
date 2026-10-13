import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, sep, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { browserAvailable, openFixtureBrowser } from './helpers/browser-fixture.mjs';

const example = {
  schemaVersion:'artifact/v1',format:'html',id:'overflow-story',title:'Story with intrinsic overflow',width:1200,height:720,
  source:`<style>
  .journey{box-sizing:border-box;width:1200px;min-height:720px;padding:44px;background:#e8f3ee;font-family:Arial,sans-serif}
  h1{margin:0 0 8px;font-size:34px}.lede{margin:0 0 30px;font-size:17px}
  .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
  .card{min-height:245px;padding:22px;border:1px solid #c9d8d1;background:white}
  .path{margin-top:22px;padding:16px;background:#176b58;color:white}
  .viewport-probe{position:absolute;left:8px;top:8px;width:10vw;height:10vh;background:red}
  @media(min-height:721px){.viewport-probe{height:100px;background:blue}}
  @media(min-width:1201px){.viewport-probe{width:200px;background:blue}}
  </style><section class="journey"><h1>Keep the complete story visible.</h1><p class="lede">The authored cards include padding outside their minimum content height.</p>
  <div class="steps">${Array.from({length:6},(_,i)=>`<article class="card" id="${i===3?'step-note':`step-${i}`}"><h2>Step ${i+1}</h2><p>Action, response, and outcome.</p></article>`).join('')}</div>
  <div class="path" id="last-outcome">The final outcome must remain reachable.</div><div class="viewport-probe"></div></section>`,
};

test('Fit and manual zoom retain the complete authored HTML content beyond its nominal canvas', {
  skip:!browserAvailable,timeout:90_000,
},async t=>{
  const artifact=process.env.TANDEM_FIT_ARTIFACT
    ? JSON.parse(await readFile(process.env.TANDEM_FIT_ARTIFACT,'utf8')) : example;
  const designFixture=process.env.TANDEM_FIT_DESIGN
    ? JSON.parse(await readFile(process.env.TANDEM_FIT_DESIGN,'utf8'))
    : {binding:{revisionId:'exact-source-revision',digest:'exact-source-digest'},content:{
      schemaVersion:'sketch-design/v3',goal:'Show complete content',summary:'Exact source layout fixture',
      outcomes:[{id:'complete',description:'Full outcome is visible',references:[artifact.id]}],artifacts:[artifact]}};
  const root=resolve(import.meta.dirname,'../public'),scratch=resolve('.tandem',`overflow-${randomUUID()}`);
  await mkdir(scratch,{recursive:true});
  const cleanup=[],old=Object.fromEntries(['TMP','TEMP','TMPDIR'].map(key=>[key,process.env[key]]));
  let browser;
  try{
    for(const key of Object.keys(old))process.env[key]=scratch;
    browser=await openFixtureBrowser({after:fn=>cleanup.push(fn)});
  }finally{
    for(const [key,value] of Object.entries(old))if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
  const server=createServer(async(req,res)=>{
    if(req.url==='/'){
      res.setHeader('content-type','text/html');
      res.end('<!doctype html><style>body{margin:8px;font:14px system-ui}#panel{width:820px;height:700px;overflow:auto}button{font:inherit}.raw-block[hidden]{display:none}</style><div id="panel" data-artifact-panel><nav id="tabs"></nav><div id="backbone-proposal"></div></div>');
      return;
    }
    try{
      const path=resolve(root,`.${new URL(req.url,'http://localhost').pathname}`);
      if(!path.startsWith(root+sep))throw new Error();
      res.setHeader('content-type',path.endsWith('.json')?'application/json':'text/javascript');
      res.end(await readFile(req.url==='/artifacts/index.js'&&process.env.TANDEM_FIT_BASELINE ? process.env.TANDEM_FIT_BASELINE : path));
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  t.after(async()=>{
    for(const close of cleanup)await close();
    server.closeAllConnections();await new Promise(done=>server.close(done));
    await rm(scratch,{recursive:true,force:true,maxRetries:15,retryDelay:200});
  });
  await browser.call('Emulation.setDeviceMetricsOverride',{width:900,height:760,deviceScaleFactor:1,mobile:false});
  await browser.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
  await browser.waitFor("document.querySelector('#panel')");
  await browser.evaluate(`(async()=>{
    const {createSharedDesignView}=await import('/renderers/shared-design.js');
    globalThis.artifact=${JSON.stringify(artifact)};
    globalThis.design=${JSON.stringify(designFixture)};
    globalThis.view=createSharedDesignView({tabs:document.querySelector('#tabs'),mount:document.querySelector('#backbone-proposal')});
    view.render(design);
    await document.querySelector('figure').ready;
    view.inspectReference(design.binding,artifact.id+'#step-note');
    document.querySelector('.artifact-element-details').open=false;
  })()`);
  const settle=()=>browser.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
  const metrics=()=>browser.evaluate(`(()=>{
    const figure=document.querySelector('figure'),frame=figure.captureElement,body=frame.contentDocument.body;
    const viewport=figure.querySelector('[data-artifact-viewport]'),surface=viewport.firstElementChild;
    const box=node=>node.getBoundingClientRect().toJSON();
    return {format:artifact.format,declared:{width:artifact.width,height:artifact.height},scale:figure.getViewState().scale,
      frame:box(frame),native:{width:frame.clientWidth,height:frame.clientHeight},viewport:box(viewport),
      scroll:{width:viewport.scrollWidth,height:viewport.scrollHeight,left:viewport.scrollLeft,top:viewport.scrollTop},
      surface:box(surface),body:box(body),bodyScroll:{width:body.scrollWidth,height:body.scrollHeight},
      content:box(body.querySelector('.journey')),last:box(body.querySelector('.path')),
      svg:body.querySelector('svg')?.getAttribute('viewBox')??null,
      note:box(document.querySelector('.artifact-element-details'))};
  })()`);
  await settle();
  const before=await metrics();
  const evidence=process.env.TANDEM_FIT_EVIDENCE;
  if(evidence){
    await mkdir(evidence,{recursive:true});
    await writeFile(join(evidence,'fit-metrics.json'),JSON.stringify(before,null,2));
    await writeFile(join(evidence,'fit.png'),await browser.screenshot());
  }
  if(process.env.TANDEM_FIT_DIAGNOSE){console.log(JSON.stringify(before));await browser.call('Browser.close');return;}
  assert.ok(before.native.height>=before.content.bottom,'The full content, not just the declared canvas, must be inside the capture surface.');
  assert.ok(before.frame.height<=before.viewport.height+1,'Fit must contain the complete surface without vertical clipping.');
  if(!process.env.TANDEM_FIT_ARTIFACT){
    assert.deepEqual(await browser.evaluate(`(()=>{
      const node=document.querySelector('iframe').contentDocument.querySelector('.viewport-probe');
      return {height:node.getBoundingClientRect().height,width:node.getBoundingClientRect().width,color:node.ownerDocument.defaultView.getComputedStyle(node).backgroundColor};
    })()`),{height:72,width:120,color:'rgb(255, 0, 0)'},'Derived extent must preserve authored viewport units and height media queries.');
  }
  const receipts=[];
  for(const width of [820,340]){
    await browser.call('Emulation.setDeviceMetricsOverride',{width:width===820?900:390,height:760,deviceScaleFactor:1,mobile:false});
    await browser.evaluate(`document.querySelector('#panel').style.width='${width}px';document.querySelector('[data-artifact-zoom="fit"]').click()`);
    await settle();
    const fit=await metrics();
    assert.ok(fit.frame.width<=fit.viewport.width+1);
    assert.ok(fit.frame.height<=fit.viewport.height+1);
    assert.ok(fit.scroll.height<=fit.viewport.height+1,'Fit has no hidden remainder.');
    for(const open of [true,false]){
      await browser.evaluate(`document.querySelector('.artifact-element-details').open=${open}`);
      await settle();
      const note=await metrics();
      assert.equal(note.native.height,fit.native.height);
      assert.equal(note.scale,fit.scale,'Notes never redefine the source canvas.');
      if(evidence){
        const image=await browser.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        await writeFile(join(evidence,`fit-notes-${open?'expanded':'collapsed'}-${width}.png`),Buffer.from(image.data,'base64'));
      }
    }
    await browser.evaluate(`(()=>{document.querySelector('[data-artifact-zoom="actual"]').click();const v=document.querySelector('[data-artifact-viewport]');v.scrollLeft=v.scrollWidth;v.scrollTop=v.scrollHeight})()`);
    await settle();
    const actual=await metrics();
    assert.equal(actual.scale,1);
    assert.ok(actual.scroll.top>0,'Authored size exposes real vertical scrolling.');
    assert.ok(actual.scroll.left>0,'Authored size exposes real horizontal scrolling.');
    const capture=await browser.evaluate(`(async()=>{
      const {visibleDiagramRegion}=await import('/annotation-controller.js');
      const {captureAnnotatedDiagram}=await import('/annotation-capture.js');
      const candidate=view.candidates()[0];candidate.prepareCapture();
      const frame=candidate.element,region=visibleDiagramRegion(frame,document.querySelector('#panel')).viewport;
      const bounds=frame.getBoundingClientRect(),last=frame.contentDocument.querySelector('.path').getBoundingClientRect();
      const point={x:Math.floor(region.width/2),y:Math.floor(last.bottom-6-region.y)};
      if(point.y<0||point.y>=region.height)throw new Error('The last outcome cannot be reached.');
      const blob=await captureAnnotatedDiagram(frame,region,[]);
      const image=await createImageBitmap(blob),canvas=document.createElement('canvas');
      canvas.width=image.width;canvas.height=image.height;
      const context=canvas.getContext('2d');context.drawImage(image,0,0);
      const pixel=[...context.getImageData(point.x,point.y,1,1).data];
      const marked=await captureAnnotatedDiagram(frame,region,[[point]]);
      const markedImage=await createImageBitmap(marked);context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(markedImage,0,0);
      const mark=[...context.getImageData(point.x,point.y,1,1).data];
      const encode=blob=>new Promise(done=>{const reader=new FileReader();reader.onload=()=>done(reader.result);reader.readAsDataURL(blob)});
      return {source:{...candidate.identity,viewport:region},point,screen:{x:Math.round(bounds.x+region.x+point.x),y:Math.round(bounds.y+region.y+point.y)},
        pixel,mark,width:image.width,height:image.height,png:await encode(blob),marked:await encode(marked)};
    })()`);
    assert.equal(capture.source.artifactId,artifact.id);
    assert.equal(capture.source.revisionId,designFixture.binding.revisionId);
    assert.equal(capture.source.designDigest,designFixture.binding.digest);
    assert.equal(capture.source.selectionId,'step-note');
    assert.equal(capture.width,capture.source.viewport.width);
    assert.equal(capture.height,capture.source.viewport.height);
    assert.deepEqual(capture.mark,[228,93,52,255],'The mark remains at its bitmap-local coordinate.');
    const live=await browser.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    const comparison=await browser.evaluate(`(async()=>{
      const image=new Image();image.src='data:image/png;base64,${live.data}';await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const context=canvas.getContext('2d');context.drawImage(image,0,0);
      const pixel=[...context.getImageData(${capture.screen.x},${capture.screen.y},1,1).data];
      const live=context.getImageData(${capture.screen.x-capture.point.x},${capture.screen.y-capture.point.y},${capture.width},${capture.height}).data;
      image.src=${JSON.stringify(capture.png)};await image.decode();context.clearRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0);
      const exported=context.getImageData(0,0,${capture.width},${capture.height}).data;
      let differences=0,pixels=0,unaligned=0;
      const shifts=Array.from({length:9},(_,i)=>({x:i%3-1,y:Math.floor(i/3)-1,differences:0}));
      for(let y=1;y<${capture.height}-1;y+=3)for(let x=1;x<${capture.width}-1;x+=3){
        pixels++;const i=(y*${capture.width}+x)*4;let matches=false;
        for(const shift of shifts){
          const j=((y+shift.y)*${capture.width}+x+shift.x)*4;
          // Native Windows text uses colored LCD antialiasing; foreignObject PNG
          // text uses grayscale antialiasing. Compare intensity for crop geometry.
          const different=Math.abs(live[i]+live[i+1]+live[i+2]-exported[j]-exported[j+1]-exported[j+2])>72;
          if(different){shift.differences++;if(!shift.x&&!shift.y)differences++;}else matches=true;
        }
        if(!matches)unaligned++;
      }
      shifts.sort((a,b)=>a.differences-b.differences);
      return {pixel,differences,pixels,unaligned,bestOffset:shifts[0]};
    })()`);
    assert.deepEqual(capture.pixel,comparison.pixel,'The bottom-source PNG pixel must equal the actual visible source pixel.');
    assert.equal(comparison.bestOffset.x,0,JSON.stringify(comparison));
    assert.equal(comparison.bestOffset.y,0,JSON.stringify(comparison));
    assert.ok(comparison.unaligned/comparison.pixels<.01,`The full visible source crop must align within one raster pixel: ${JSON.stringify(comparison)}`);
    if(evidence){
      await writeFile(join(evidence,`native-${width}.png`),Buffer.from(live.data,'base64'));
      await writeFile(join(evidence,`capture-${width}.png`),Buffer.from(capture.png.split(',')[1],'base64'));
      await writeFile(join(evidence,`marked-${width}.png`),Buffer.from(capture.marked.split(',')[1],'base64'));
    }
    delete capture.png;delete capture.marked;
    receipts.push({width,fit,actual,capture,comparison});
    await browser.evaluate("(()=>{document.querySelector('[data-artifact-zoom=\"out\"]').click();const v=document.querySelector('[data-artifact-viewport]');v.scrollTop=v.scrollHeight})()");
    await settle();
    const zoom=await metrics();
    assert.equal(zoom.scale,.75);
    assert.ok(zoom.scroll.height>=zoom.native.height*.75-1);
    assert.ok(zoom.frame.bottom<=zoom.viewport.bottom+1,'Manual zoom can reach the complete bottom edge.');
  }
  assert.equal(await browser.evaluate('design.content.artifacts[0].source'),artifact.source,'Canonical source remains byte-for-byte unchanged.');
  const boundaries=await browser.evaluate(`(async()=>{
    const {renderArtifact}=await import('/artifacts/renderer.js');
    const results=[];
    for(const source of [${JSON.stringify(example.source.replace('width:1200px','width:1400px'))},
      '<div style="height:100px;overflow:clip"><div style="height:1100px">Intentionally clipped source</div></div>']){
      const figure=renderArtifact(document,{...artifact,source});document.body.append(figure);
      await figure.ready;
      const frame=figure.captureElement,probe=frame.contentDocument.querySelector('.viewport-probe');
      results.push({width:frame.clientWidth,height:frame.clientHeight,
        probe:probe?{width:probe.getBoundingClientRect().width,height:probe.getBoundingClientRect().height,color:frame.contentWindow.getComputedStyle(probe).backgroundColor}:null});
      figure.dispose();figure.remove();
    }
    return results;
  })()`);
  assert.equal(boundaries[0].width,1400,'Positive horizontal overflow belongs to the host viewport too.');
  assert.deepEqual(boundaries[0].probe,{width:120,height:72,color:'rgb(255, 0, 0)'});
  assert.equal(boundaries[1].width,artifact.width);
  assert.equal(boundaries[1].height,artifact.height,'Explicit source clipping is not expanded or removed.');
  await t.test('HTML overflow validates all descendants before one bounded style-freezing pass',async()=>{
    const workload=await browser.evaluate(`(async()=>{
      const {renderArtifact}=await import('/artifacts/renderer.js');
      const results=[],count=1000;
      for(const rejectLast of [false,true]){
        let reads=0,writes=0;
        const rendererDocument={defaultView:window,createElement(tag){
          const node=document.createElement(tag);
          if(tag==='iframe')node.addEventListener('load',()=>{
            const body=node.contentDocument?.body;
            if(!body?.hasAttribute('data-artifact-surface'))return;
            const view=node.contentWindow,computed=view.getComputedStyle.bind(view);
            const set=view.CSSStyleDeclaration.prototype.setProperty;
            view.CSSStyleDeclaration.prototype.setProperty=function(...args){
              if(++writes>count+80)throw new Error('Unbounded style-freezing writes');
              return set.apply(this,args);
            };
            view.getComputedStyle=element=>{
              if(++reads>count*3+20)throw new Error('Unbounded computed-style reads');
              const style=computed(element);
              return {overflowX:style.overflowX,
                overflowY:rejectLast&&element===body.firstElementChild.lastElementChild?'auto':style.overflowY,
                getPropertyValue:property=>style.getPropertyValue(property),
                *[Symbol.iterator](){yield 'color';}};
            };
          });
          return node;
        }};
        const figure=renderArtifact(rendererDocument,{...artifact,source:'<div style="height:872px">'+'<span></span>'.repeat(count)+'</div>'});
        document.body.append(figure);
        try{
          await figure.ready;
          results.push({rejectLast,reads,writes,height:figure.captureElement.clientHeight,error:null});
        }catch(error){results.push({rejectLast,reads,writes,error:error.message,capture:figure.captureElement});}
        finally{figure.dispose();figure.remove();}
      }
      return results;
    })()`);
    assert.equal(workload[0].error,null,JSON.stringify(workload));
    assert.equal(workload[0].height,872);
    assert.equal(workload[0].reads,2004,'1001 descendant validations plus one freeze of html/body/1001 descendants.');
    assert.ok(workload[0].writes<=1080,JSON.stringify(workload));
    assert.match(workload[1].error,/scrollable region/);
    assert.equal(workload[1].capture,null);
    assert.equal(workload[1].reads,1001,'Even the final invalid descendant must be checked before freezing.');
    assert.ok(workload[1].writes<50,'Rejected layouts must not enter the style-freezing pass.');
    if(evidence)await writeFile(join(evidence,'workload.json'),JSON.stringify(workload,null,2));
  });
  const oversized=await browser.evaluate(`(async()=>{
    const {renderArtifact}=await import('/artifacts/renderer.js');
    const figure=renderArtifact(document,{...artifact,source:'<div style="height:5000px">Too tall</div>'});
    document.body.append(figure);
    try{await figure.ready;return null;}catch(error){return {message:error.message,capture:figure.captureElement};}finally{figure.dispose();figure.remove();}
  })()`);
  assert.match(oversized.message,/4096px/);
  assert.equal(oversized.capture,null);
  if(evidence)await writeFile(join(evidence,'validation.json'),JSON.stringify(receipts,null,2));
  assert.deepEqual(browser.exceptions,[]);
  await browser.call('Browser.close');
});
