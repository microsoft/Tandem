import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { browserAvailable, openFixtureBrowser } from './helpers/browser-fixture.mjs';

// Saved 50996 geometry: pane y162.5625..900, width791; Fit image
// y559.625..994.625, width724/height435. This is a layout replay, not native E2E.
const example = { schemaVersion:'artifact/v1',format:'html',id:'fit-pane',title:'Complete overview',width:1448,height:870,
  source:'<section style="position:relative;width:1448px;height:870px;background:#ddeeff"><div style="position:absolute;left:0;top:670px;width:1448px;height:200px;background:#176b58">Last section</div></section>' };

test('explicit Fit reveals the complete overview in the saved integrated outer-pane layout', {
  skip:!browserAvailable,timeout:90_000,
},async t=>{
  const root=resolve(import.meta.dirname,'../public'),scratch=resolve('.tandem',`fit-pane-${randomUUID()}`);
  await mkdir(scratch,{recursive:true});
  const cleanups=[],previous=Object.fromEntries(['TEMP','TMP','TMPDIR'].map(key=>[key,process.env[key]]));
  let browser;
  try{
    for(const key of Object.keys(previous))process.env[key]=scratch;
    browser=await openFixtureBrowser({after:fn=>cleanups.push(fn)});
  }finally{
    for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;
  }
  const artifact=example;
  const server=createServer(async(req,res)=>{
    if(req.url==='/'){
      res.setHeader('content-type','text/html');
      res.end(`<!doctype html><style>
        body{margin:0;font:14px/20px system-ui}button{font:inherit}
        #design-panel{position:absolute;left:0;top:75px;width:791px;height:calc(100vh - 75px);overflow:hidden}
        .panel-heading{height:87.5625px}
        #canvas-scroll{height:calc(100% - 87.5625px);overflow:auto}
        #content{padding:0 26px 26px}
        #summary{height:335.0625px}
        #notes summary{height:27px}#notes p{height:180px;margin:0}
        @media(max-width:600px){#design-panel{width:100%}}
        </style><section id="design-panel"><header class="panel-heading">Design</header>
        <div id="canvas-scroll"><div id="content"><div id="summary">Saved layout: summary, navigation and description precede the artifact.</div>
        <div id="mount"></div><details id="notes"><summary>Step note</summary><p>Expanded note below the artifact.</p></details></div></div></section>`);
      return;
    }
    try{
      const pathname=new URL(req.url,'http://localhost').pathname,path=resolve(root,`.${pathname}`);
      if(!path.startsWith(root+sep))throw new Error('Invalid path');
      res.setHeader('content-type','text/javascript');
      res.end(await readFile(pathname==='/artifacts/index.js'&&process.env.TANDEM_FIT_PANE_BASELINE
        ? process.env.TANDEM_FIT_PANE_BASELINE:path));
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  t.after(async()=>{
    for(const close of cleanups)await close();
    server.closeAllConnections();await new Promise(done=>server.close(done));
    await rm(scratch,{recursive:true,force:true,maxRetries:15,retryDelay:200});
  });
  const evidence=process.env.TANDEM_FIT_PANE_EVIDENCE,receipts=[];
  if(evidence)await mkdir(evidence,{recursive:true});
  const settle=()=>browser.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
  const metrics=()=>browser.evaluate(`(()=>{
    const box=node=>node.getBoundingClientRect().toJSON(),outer=document.querySelector('#canvas-scroll');
    return {outer:box(outer),outerTop:outer.scrollTop,outerHeight:outer.clientHeight,outerScrollHeight:outer.scrollHeight,
      figure:box(figure),image:box(figure.captureElement),controls:box(figure.querySelector('[aria-label="Artifact zoom"]')),
      state:figure.getViewState(),pageY:scrollY};
  })()`);
  const screenshot=async name=>{
    if(!evidence)return;
    const image=await browser.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(join(evidence,`${name}.png`),Buffer.from(image.data,'base64'));
  };
  for(const [width,height] of [[1440,900],[1440,440],[390,900],[390,440]])await t.test(`${width}x${height}`,async()=>{
    const input=width===390&&height===440 ? {...artifact,
      title:'Review the daily checklist, its saved note, the current completion state, and all persistence outcomes before proceeding'} : artifact;
    await browser.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await browser.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
    await browser.waitFor("document.querySelector('#mount')");
    await browser.evaluate(`(async()=>{
      const {renderArtifact}=await import('/artifacts/renderer.js');
      globalThis.artifact=${JSON.stringify(input)};
      globalThis.figure=renderArtifact(document,artifact);
      document.querySelector('#mount').append(figure);await figure.ready;
    })()`);
    await settle();
    const initial=await metrics();
    assert.equal(initial.outerTop,0,'Initial rendering never navigates the outer pane.');
    if(width===1440&&height===900){
      assert.ok(Math.abs(initial.outer.top-162.5625)<1);
      assert.ok(initial.image.bottom>initial.outer.bottom+90,'Reproduce the reachable offscreen remainder.');
    }
    await screenshot(`before-${width}-${height}`);
    for(const expanded of [false,true]){
      await browser.evaluate(`document.querySelector('#notes').open=${expanded};document.querySelector('#canvas-scroll').scrollTop=0`);
      // Deliberate fixture navigation brings the control into reach in short
      // panes; the actual Fit action below is a real mouse click.
      await browser.evaluate(`(()=>{
        const outer=document.querySelector('#canvas-scroll'),button=figure.querySelector('[data-artifact-zoom="fit"]');
        const r=button.getBoundingClientRect(),pane=outer.getBoundingClientRect();
        if(r.bottom>pane.bottom||r.top<pane.top)outer.scrollTop+=r.top-pane.top-12;
      })()`);
      await settle();
      const before=await metrics();
      const point=await browser.evaluate(`(()=>{
        const r=figure.querySelector('[data-artifact-zoom="fit"]').getBoundingClientRect();
        return {x:r.x+r.width/2,y:r.y+r.height/2};
      })()`);
      await browser.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
      await browser.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
      await settle();
      const fit=await metrics();
      await screenshot(`fit-${width}-${height}-${expanded?'expanded':'collapsed'}`);
      if(evidence)await writeFile(join(evidence,`geometry-${width}-${height}-${expanded}.json`),JSON.stringify({initial,before,fit},null,2));
      assert.ok(fit.image.bottom<=fit.outer.bottom+1,JSON.stringify(fit));
      assert.ok(fit.image.top>=fit.outer.top-1,JSON.stringify(fit));
      assert.ok(fit.figure.top>=fit.outer.top-1,'The overview title remains in context.');
      assert.ok(fit.controls.top>=fit.outer.top-1,'Fit controls remain reachable above the complete image.');
      assert.ok(fit.image.width<=fit.outer.width);
      assert.equal(fit.state.fit,true);
      assert.equal(fit.pageY,before.pageY,'Fit navigates the owning pane, not the surrounding document.');
      assert.equal(fit.state.scrollLeft,0);assert.equal(fit.state.scrollTop,0);
      await browser.evaluate('figure.refreshLayout();figure.restoreViewState(figure.getViewState())');
      await settle();
      assert.equal((await metrics()).outerTop,fit.outerTop,'Capture preparation/restoration never navigates.');
      await browser.evaluate("figure.querySelector('[data-artifact-zoom=\"actual\"]').click()");
      await settle();
      const native=await metrics();
      assert.equal(native.outerTop,fit.outerTop,'Ordinary zoom must not navigate the outer pane.');
      assert.equal(native.state.scale,1);
      assert.equal(native.image.width,artifact.width);
      await browser.evaluate("(()=>{const v=figure.querySelector('[data-artifact-viewport]');v.scrollLeft=v.scrollWidth;v.scrollTop=v.scrollHeight})()");
      const capture=await browser.evaluate(`(async()=>{
        const {visibleDiagramRegion}=await import('/annotation-controller.js');
        const {captureAnnotatedDiagram}=await import('/annotation-capture.js');
        const region=visibleDiagramRegion(figure.captureElement,document.querySelector('#design-panel')).viewport;
        const blob=await captureAnnotatedDiagram(figure.captureElement,region,[]),image=await createImageBitmap(blob);
        const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
        c.getContext('2d').drawImage(image,0,0);
        return {region,width:image.width,height:image.height,pixel:[...c.getContext('2d').getImageData(Math.floor(image.width/2),image.height-20,1,1).data]};
      })()`);
      assert.ok(capture.region.x>0&&capture.region.y>0);
      assert.equal(capture.width,capture.region.width);assert.equal(capture.height,capture.region.height);
      assert.deepEqual(capture.pixel,[23,107,88,255],'Native scrolled capture retains the exact bottom-source pixel.');
      assert.equal(await browser.evaluate('artifact.source'),artifact.source);
      receipts.push({width,height,expanded,initial,before,fit,native,capture});
    }
  });
  if(evidence)await writeFile(join(evidence,'results.json'),JSON.stringify(receipts,null,2));
  assert.deepEqual(browser.exceptions,[]);
});
