import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { browserAvailable, openFixtureBrowser } from './helpers/browser-fixture.mjs';
import { multiFormatDesign } from './fixtures/multi-format.mjs';

for (const width of [1440, 390]) for (const theme of ['light', 'dark']) test(
  `snapshot-first annotation preserves bitmap coordinates and identity at ${width}px ${theme}`, {
    skip: !browserAvailable, timeout: 90_000,
  }, async t => {
    const root = resolve(import.meta.dirname, '../public');
    const scratch = resolve('.tandem', `annotation-snapshot-${randomUUID()}`);
    await mkdir(scratch, { recursive: true });
    const cleanups = [];
    const previous = Object.fromEntries(['TMP', 'TEMP', 'TMPDIR'].map(key => [key, process.env[key]]));
    let browser;
    try {
      for (const key of Object.keys(previous)) process.env[key] = scratch;
      browser = await openFixtureBrowser({ after: close => cleanups.push(close) });
    } finally {
      for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    const content = multiFormatDesign();
    content.artifacts[0].category = 'user-story';
    content.artifacts[1].category = content.artifacts[2].category = 'ui';
    content.artifacts.push({ schemaVersion:'artifact/v2',format:'markdown',id:'notes',title:'Notes',noteForArtifactId:'checkout',source:'Read only notes.' });
    const snapshot = {
      schemaVersion:'human-loop-snapshot-view/v1',streamId:'snapshot-editor',
      conversationStatus:'verified',
      installation:{status:'ready',canStart:false,canReopen:false},
      design:{binding:{revisionId:'snapshot-design',digest:'original-digest'},content},
      workflow:{schemaVersion:'human-loop-view/v1',status:'ready',reason:null,activeRequestId:null,activeRole:null,
        workspacePath:'Fixture',currentCycle:null,lastHandoff:null,queue:[],canStop:false,canSend:true,questionInteractions:[]},
      messages:[],events:[],accessRequests:[],processes:{apps:[],commands:[]},
    };
    const posts = [], clients = new Set();
    const server = createServer(async (request, response) => {
      try {
        if (request.method !== 'GET') { posts.push(request.url); response.writeHead(405); response.end(); return; }
        const path = new URL(request.url, 'http://localhost').pathname;
        if (path === '/api/events') {
          response.writeHead(200, {'content-type':'text/event-stream'});
          clients.add(response); response.on('close',()=>clients.delete(response));
          response.write('event: update\ndata: {}\n\n'); return;
        }
        const json = path === '/api/snapshot' ? snapshot : path === '/api/settings'
          ? {preferences:{theme,fontSize:'normal'},model:{models:[],actual:null,canChange:false}} : null;
        if (json) { response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify(json));return; }
        const file = resolve(root,path==='/'?'human-loop.html':path.slice(1));
        if (!file.startsWith(root+sep)) throw new Error('Invalid asset');
        let source = await readFile(path==='/snapshot-annotation-controller.js' && process.env.TANDEM_SNAPSHOT_BASELINE
          ? process.env.TANDEM_SNAPSHOT_BASELINE : file);
        if (path === '/human-loop-app.js') source = source.toString().replace("panel: $('design-panel'), artifactMode: true,",
          "panel: $('design-panel'), artifactMode: true, onPreviewChange:()=>{if(globalThis.rejectAnnotation)throw new Error('Fixture composer rejected attachment');if(globalThis.delayAnnotationAcceptance)return new Promise(resolve=>globalThis.acceptAnnotation=resolve);},")
          + '\nglobalThis.testAnnotation=annotation;globalThis.testDesign=designView;';
        response.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css',
          '.json':'application/json','.jpg':'image/jpeg'}[extname(file)]??'application/octet-stream'});
        response.end(source);
      } catch (error) { response.writeHead(500);response.end(error.message); }
    });
    await new Promise(done=>server.listen(0,'127.0.0.1',done));
    t.after(async()=>{
      for(const cleanup of cleanups) await cleanup();
      server.closeAllConnections();await new Promise(done=>server.close(done));
      await rm(scratch,{recursive:true,force:true,maxRetries:15,retryDelay:200});
    });
    await browser.call('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    await browser.call('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
    await browser.waitFor("document.querySelector('[data-artifact-group=\"ui\"]') && globalThis.testAnnotation");
    const click = selector=>browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const clickVisible = async selector => {
      const point = await browser.evaluate(`(()=>{
        const button=document.querySelector(${JSON.stringify(selector)}),r=button.getBoundingClientRect();
        const x=r.x+r.width/2,y=r.y+r.height/2;
        return {x,y,hit:document.elementFromPoint(x,y)?.outerHTML.slice(0,240),
          visible:r.width>0&&r.height>0&&x>=0&&y>=0&&x<innerWidth&&y<innerHeight
          &&button.contains(document.elementFromPoint(x,y))};
      })()`);
      assert.equal(point.visible,true,`${selector} is reachable without scrolling: ${JSON.stringify(point)}`);
      for (const type of ['mousePressed','mouseReleased']) await browser.call('Input.dispatchMouseEvent',
        {type,button:'left',clickCount:1,x:point.x,y:point.y});
    };
    const action = name=>click(`[data-annotation-action="${name}"]`);
    const settle = ()=>browser.evaluate('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
    const ink = ()=>browser.evaluate("document.querySelector('.annotation-editor-ink').toDataURL()");
    const base = ()=>browser.evaluate("document.querySelector('.annotation-editor-base').src");
    const open = ()=>browser.waitFor("document.querySelector('.annotation-editor').open && !testAnnotation.isCapturing() && document.querySelector('.annotation-editor-base').naturalWidth>0");
    const evidence = process.env.TANDEM_BROWSER_ARTIFACTS;
    const record = async name=>{
      if(!evidence)return;
      await mkdir(evidence,{recursive:true});
      await writeFile(join(evidence,`snapshot-${width}-${theme}-${name}.png`),await browser.screenshot());
    };
    await click('[data-artifact-group="ui"]');
    await browser.waitFor("document.querySelector('.source-artifact iframe') && !document.querySelector('.annotation-view-toggle').disabled");
    await browser.evaluate('document.fonts.ready');
    await click('[data-artifact-zoom="in"]');await click('[data-artifact-zoom="fit"]');
    await browser.evaluate("document.querySelector('.source-artifact iframe').scrollIntoView({block:'center'})");
    await settle();
    await click('.raw-toggle');
    assert.equal(await browser.evaluate("document.querySelector('.annotation-view-toggle').disabled"),true,'Raw cannot start visual capture.');
    await click('.raw-toggle');
    await click('.annotation-view-toggle');await open();
    await record('capture');
    assert.equal(await browser.evaluate("document.querySelector('#annotation-preview').hidden"),true,'Annotate does not attach or send.');
    const originalBase = await base();
    async function draw(x,y) {
      const point = await browser.evaluate(`(()=>{
        const c=document.querySelector('.annotation-editor-ink'),r=c.getBoundingClientRect();
        return {x:r.x+r.width*${x},y:r.y+r.height*${y},dx:r.width*.08,dy:r.height*.05};
      })()`);
      await browser.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:point.x,y:point.y});
      await browser.call('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:point.x+point.dx,y:point.y+point.dy});
      await browser.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:point.x+point.dx,y:point.y+point.dy});
    }
    await draw(.25,.25);
    const firstInk = await ink();
    await browser.evaluate("document.querySelector('[data-artifact-zoom=\"in\"]').click();document.querySelector('#canvas-scroll').scrollTop+=150");
    await settle();
    assert.equal(await base(),originalBase);
    assert.equal(await ink(),firstInk,'Underlying zoom and scroll cannot move marks.');
    await browser.call('Emulation.setDeviceMetricsOverride',{width:width===1440?900:360,height:850,deviceScaleFactor:1,mobile:false});
    await settle();
    assert.equal(await ink(),firstInk,'Editor resize does not resample stroke coordinates.');
    const alignment = await browser.evaluate(`(()=>{
      const a=document.querySelector('.annotation-editor-base').getBoundingClientRect(),b=document.querySelector('.annotation-editor-ink').getBoundingClientRect();
      return [a.x-b.x,a.y-b.y,a.width-b.width,a.height-b.height];
    })()`);
    for(const delta of alignment)assert.ok(Math.abs(delta)<1,JSON.stringify(alignment));
    await draw(.6,.6);
    let drawn = await ink();
    await action('close');
    assert.equal(await browser.evaluate("document.querySelector('#annotation-preview').hidden"),true);
    assert.equal(await browser.evaluate("document.querySelector('.annotation-view-toggle').textContent"),'Resume sketch');
    await click('.annotation-view-toggle');await open();
    assert.equal(await ink(),drawn,'Return retains the exact draft.');
    assert.equal(await base(),originalBase);
    await browser.evaluate('globalThis.delayAnnotationAcceptance=true');
    await action('attach');
    await browser.waitFor('typeof acceptAnnotation==="function"');
    await record('awaiting-acceptance');
    assert.equal(await ink(),drawn,'The draft remains intact until the composer accepts the attachment.');
    assert.equal(await browser.evaluate('testAnnotation.preview()'),null);
    assert.equal(await browser.evaluate("document.querySelector('.annotation-editor').open"),true);
    await browser.evaluate('delayAnnotationAcceptance=false;acceptAnnotation();delete globalThis.acceptAnnotation');
    await browser.waitFor("!document.querySelector('.annotation-editor').open && testAnnotation.preview() !== null");
    const source = await browser.evaluate('testAnnotation.preview().source');
    assert.equal(source.artifactId,'checkout');assert.equal(source.revisionId,'snapshot-design');assert.equal(source.designDigest,'original-digest');
    assert.equal(await browser.evaluate("document.querySelector('#annotation-caption .annotation-preview-status').textContent.trim()"),'Not sent.');
    assert.equal(await browser.evaluate("document.querySelector('#annotation-caption .annotation-preview-provenance').textContent"),
      `PNG snapshot - ${source.artifactId}, revision ${source.revisionId}.`);
    const exported = await browser.evaluate(`(async()=>{
      const p=testAnnotation.preview(),image=new Image();image.src=p.url;await image.decode();
      const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;
      c.getContext('2d').drawImage(image,0,0);
      const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      const marks=new Image();marks.src=${JSON.stringify(drawn)};await marks.decode();
      const ink=document.createElement('canvas');ink.width=marks.width;ink.height=marks.height;
      ink.getContext('2d').drawImage(marks,0,0);
      const b=ink.getContext('2d').getImageData(0,0,ink.width,ink.height).data;
      let solid=0,aligned=0;
      for(let i=0;i<b.length;i+=4)if(b[i+3]>250){solid++;if(Math.abs(a[i]-228)<3&&Math.abs(a[i+1]-93)<3&&Math.abs(a[i+2]-52)<3)aligned++;}
      return {solid,aligned,width:c.width,height:c.height,bytes:[...new Uint8Array(await p.blob.arrayBuffer())]};
    })()`);
    assert.ok(exported.solid>30);assert.ok(exported.aligned/exported.solid>.98);
    assert.equal(exported.width,source.viewport.width);assert.equal(exported.height,source.viewport.height);
    if(evidence){
      await writeFile(join(evidence,`snapshot-${width}-${theme}-export.png`),Buffer.from(exported.bytes));
      await writeFile(join(evidence,`snapshot-${width}-${theme}-source.json`),JSON.stringify({source,...exported,bytes:undefined},null,2));
    }
    await record('attached-label');
    const emptyInk = ()=>browser.evaluate("(()=>{const c=document.querySelector('.annotation-editor-ink');return !c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((value,index)=>index%4===3&&value)})()");
    assert.equal(await browser.evaluate("document.querySelector('.annotation-view-toggle').textContent"),'Annotate');
    assert.equal(await browser.evaluate("document.querySelector('.annotation-editor-base').getAttribute('src')"),null);
    assert.equal(await emptyInk(),true,'Successful attachment clears the completed editable strokes.');
    const previewUrl = await browser.evaluate('testAnnotation.preview().url');
    await browser.evaluate("document.querySelector('#message').value='Keep my unsent message';document.querySelector('#message').dispatchEvent(new Event('input',{bubbles:true}))");
    for (const mode of ['no-strokes', 'drawn', 'paused', 'escape', 'encoding', 'capturing']) {
      await browser.evaluate("document.querySelector('.source-artifact iframe').scrollIntoView({block:'center'})");
      await settle();
      const delayEncoding = () =>
        browser.evaluate(`(()=>{
          globalThis.beforeCancelToBlob=HTMLCanvasElement.prototype.toBlob;
          HTMLCanvasElement.prototype.toBlob=function(callback,...args){
            beforeCancelToBlob.call(this,blob=>{globalThis.finishCanceledExport=()=>callback(blob)},...args);
          };
        })()`);
      if (mode === 'capturing') await delayEncoding();
      await click('.annotation-view-toggle');
      if (mode === 'capturing') await browser.waitFor('typeof finishCanceledExport==="function" && document.querySelector(".annotation-editor").open');
      else await open();
      const canceledUrl = mode === 'capturing' ? null : await base();
      if (!['no-strokes', 'capturing'].includes(mode)) await draw(.3,.3);
      if (mode === 'encoding') {
        await delayEncoding();
        await action('attach');
        await browser.waitFor('typeof finishCanceledExport==="function"');
      }
      if (mode === 'paused') {
        await action('close');
        await browser.evaluate("document.querySelector('#message').focus({preventScroll:true})");
        await browser.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await browser.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        assert.equal(await browser.evaluate("document.querySelector('.annotation-view-toggle').textContent"),'Resume sketch');
        assert.equal(await browser.evaluate("document.querySelector('[data-cancel-annotation-artifact]').hidden"),false);
        await click('[data-cancel-annotation-artifact]');
      } else if (mode === 'escape') {
        await browser.evaluate("document.querySelector('[data-annotation-action=\"cancel\"]').focus()");
        await browser.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
        await browser.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      } else await clickVisible('[data-annotation-action="cancel"]');
      if (['encoding', 'capturing'].includes(mode)) {
        await browser.evaluate('HTMLCanvasElement.prototype.toBlob=beforeCancelToBlob;finishCanceledExport();delete globalThis.finishCanceledExport');
        await browser.waitFor('!testAnnotation.isCapturing()');
      }
      assert.equal(await browser.evaluate("document.querySelector('.annotation-editor').open"),false,mode);
      assert.equal(await browser.evaluate("document.querySelector('.annotation-view-toggle').textContent"),'Annotate',mode);
      assert.equal(await browser.evaluate("document.querySelector('[data-cancel-annotation-artifact]').hidden"),true,mode);
      assert.equal(await browser.evaluate("document.querySelector('.annotation-editor-base').getAttribute('src')"),null,mode);
      assert.equal(await emptyInk(),true,mode);
      assert.equal(await browser.evaluate(`document.activeElement===document.querySelector(${JSON.stringify(['encoding', 'capturing'].includes(mode) ? '.raw-toggle' : '.annotation-view-toggle')})`),true,mode);
      assert.equal(await browser.evaluate("document.querySelector('#message').value"),'Keep my unsent message',mode);
      assert.equal(await browser.evaluate('testAnnotation.preview().url'),previewUrl,mode);
      assert.deepEqual(await browser.evaluate('testAnnotation.preview().source'),source,mode);
      assert.deepEqual(await browser.evaluate('(async()=>[...new Uint8Array(await testAnnotation.preview().blob.arrayBuffer())])()'),exported.bytes,mode);
      if (canceledUrl) assert.equal(await browser.evaluate(`fetch(${JSON.stringify(canceledUrl)}).then(()=>false,()=>true)`),true,'Canceled draft URL is released.');
      assert.deepEqual(posts,[],'Cancel never uploads or sends.');
    }
    await browser.evaluate("document.querySelector('.source-artifact iframe').scrollIntoView({block:'center'})");
    await settle();
    const freshSource = await browser.evaluate(`(async()=>{
      const {visibleDiagramRegion}=await import('/annotation-controller.js'),c=testDesign.candidates()[0];
      c.prepareCapture?.();return {...c.identity,viewport:visibleDiagramRegion(c.element,document.querySelector('#design-panel')).viewport};
    })()`);
    await click('.annotation-view-toggle');await open();
    assert.notEqual(await base(),originalBase,'Annotate after completion creates a fresh capture, not a completed draft.');
    assert.equal(await emptyInk(),true);
    const freshBase = await base();
    await draw(.72,.35);drawn=await ink();
    await browser.evaluate('globalThis.rejectAnnotation=true');
    await action('attach');
    await browser.waitFor("!testAnnotation.isCapturing() && document.querySelector('.annotation-editor-status').textContent.includes('Fixture composer rejected')");
    assert.equal(await ink(),drawn);assert.equal(await base(),freshBase);
    assert.equal(await browser.evaluate('testAnnotation.preview().url'),previewUrl);
    assert.deepEqual(await browser.evaluate('(async()=>[...new Uint8Array(await testAnnotation.preview().blob.arrayBuffer())])()'),exported.bytes);
    assert.equal(await browser.evaluate('(async()=>{const image=new Image();image.src=testAnnotation.preview().url;await image.decode();return image.naturalWidth>0})()'),true,'A rejected replacement must not revoke the prior composer image.');
    await record('rejected-replacement');
    await browser.evaluate('globalThis.rejectAnnotation=false');
    await browser.evaluate('globalThis.encodeBeforeFailure=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback){callback(null)}');
    await action('attach');
    await browser.waitFor("!testAnnotation.isCapturing() && document.querySelector('.annotation-editor-status').textContent.includes('could not be encoded')");
    await browser.evaluate('HTMLCanvasElement.prototype.toBlob=encodeBeforeFailure');
    assert.equal(await ink(),drawn);assert.equal(await base(),freshBase);
    assert.equal(await browser.evaluate('testAnnotation.preview().url'),previewUrl,'Encoding failure must retain the draft and prior attachment.');
    await browser.evaluate(`(()=>{
      globalThis.savedToBlob=HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob=function(callback,...args){
        savedToBlob.call(this,blob=>{globalThis.finishExport=()=>callback(blob)},...args);
      };
    })()`);
    await action('attach');
    await browser.waitFor('typeof finishExport==="function"');
    await action('close');
    await browser.evaluate('HTMLCanvasElement.prototype.toBlob=savedToBlob;finishExport();delete globalThis.finishExport');
    await browser.waitFor('!testAnnotation.isCapturing()');
    assert.equal(await browser.evaluate('testAnnotation.preview().url'),previewUrl,'Return cancels an in-flight export without replacing the composer attachment.');
    await click('.annotation-view-toggle');await open();
    assert.equal(await ink(),drawn);
    await action('close');
    assert.equal(await browser.evaluate("document.querySelector('.annotation-editor').open"),false);
    await click('.annotation-view-toggle');await open();
    await action('capture-new');
    assert.equal(await browser.evaluate("document.querySelector('.annotation-editor-confirmation').hidden"),false);
    await action('keep');assert.equal(await ink(),drawn);
    await action('clear');
    assert.notEqual(await ink(),drawn);
    assert.equal(await base(),freshBase,'Clear strokes never recaptures the live design.');
    assert.equal(await browser.evaluate('testAnnotation.preview().url'),previewUrl,'Clear does not alter the composer attachment.');
    await draw(.4,.4);
    const kept = await ink();
    snapshot.design.binding={revisionId:'revision-after-capture',digest:'new-digest'};
    for(const client of clients)client.write('event: update\ndata: {}\n\n');
    await browser.waitFor("document.querySelector('.annotation-editor-status').textContent.includes('current Design or artifact differs')");
    assert.equal(await base(),freshBase);assert.equal(await ink(),kept);
    await record('retained-source');
    await action('close');
    assert.deepEqual(await browser.evaluate('testAnnotation.preview().source'),source,'A newer Design never silently rebinds an old bitmap.');
    await click('[data-artifact-note="notes"]');
    await browser.waitFor("document.querySelector('[data-note-primary=\"checkout\"]')");
    assert.equal(await browser.evaluate("document.querySelectorAll('.annotation-view-toggle').length"),0);
    await click('[data-note-primary="checkout"]');
    await browser.waitFor("document.querySelector('.annotation-view-toggle')");
    await click('.annotation-view-toggle');await open();
    assert.equal(await ink(),kept);
    await action('close');
    await click('[data-artifact-tab="pickup-plan"]');
    await browser.waitFor("document.querySelector('.source-artifact[data-artifact-id=\"pickup-plan\"]') && !document.querySelector('.annotation-view-toggle').disabled");
    await browser.evaluate("document.querySelector('.source-artifact iframe').scrollIntoView({block:'center'})");
    await settle();await click('.annotation-view-toggle');await open();
    assert.notEqual(await base(),originalBase);
    await draw(.3,.3);
    await action('close');
    await click('[data-cancel-annotation-artifact]');
    assert.equal(await browser.evaluate("document.querySelector('.annotation-view-toggle').textContent"),'Annotate');
    await click('[data-artifact-tab="checkout"]');
    await browser.waitFor("document.querySelector('.annotation-view-toggle')");
    await click('.annotation-view-toggle');await open();
    assert.equal(await ink(),kept,'Canceling another artifact retains this captured draft.');
    assert.equal(await base(),freshBase);
    assert.deepEqual(await browser.evaluate('testAnnotation.preview().source'),source);
    // Failed recapture preserves both the draft and composer attachment.
    await browser.evaluate("globalThis.originalToBlob=HTMLCanvasElement.prototype.toBlob;HTMLCanvasElement.prototype.toBlob=function(callback){callback(null)}");
    await action('capture-new');await action('replace');
    await browser.waitFor("!testAnnotation.isCapturing() && document.querySelector('.annotation-editor-status').textContent.includes('could not be encoded')");
    await browser.evaluate('HTMLCanvasElement.prototype.toBlob=originalToBlob');
    assert.equal(await base(),freshBase);assert.equal(await ink(),kept);
    assert.deepEqual(await browser.evaluate('testAnnotation.preview().source'),source);
    await action('close');
    await click('.raw-toggle');
    await click('.annotation-view-toggle');await open();
    await action('capture-new');await action('replace');
    await browser.waitFor("!testAnnotation.isCapturing() && document.querySelector('.annotation-editor-status').textContent.includes('Raw source cannot')");
    assert.equal(await base(),freshBase);assert.equal(await ink(),kept);
    await action('close');await click('.raw-toggle');
    await browser.evaluate("document.querySelector('.source-artifact iframe').scrollIntoView({block:'center'})");
    await settle();await click('.annotation-view-toggle');await open();
    await action('attach');
    await browser.waitFor('!testAnnotation.isCapturing() && !document.querySelector(".annotation-editor").open');
    assert.deepEqual(await browser.evaluate('testAnnotation.preview().source'),freshSource,'Successful completion preserves the unfinished draft’s original source, not the newer Design.');
    assert.equal(await emptyInk(),true);
    assert.equal(await browser.evaluate("document.querySelector('.annotation-view-toggle').textContent"),'Annotate');
    await click('.annotation-view-toggle');await open();
    const currentBase=await base();
    assert.equal(await emptyInk(),true);
    await action('capture-new');await action('replace');
    await browser.waitFor("!testAnnotation.isCapturing() && document.querySelector('.annotation-editor-base').src!=="+JSON.stringify(currentBase));
    assert.equal(await browser.evaluate("document.querySelector('[data-annotation-action=\"attach\"]').textContent"),'Attach to composer');
    assert.equal(await browser.evaluate("document.querySelector('.annotation-view-toggle').textContent"),'Resume sketch');
    await action('attach');await browser.waitFor('!testAnnotation.isCapturing() && !document.querySelector(".annotation-editor").open');
    assert.equal(await browser.evaluate('testAnnotation.preview().source.revisionId'),'revision-after-capture');
    if (width===1440 && theme==='light') {
      const limits = await browser.evaluate(`(async()=>{
        const {createSnapshotAnnotationController}=await import('/snapshot-annotation-controller.js');
        const {visibleDiagramRegion}=await import('/annotation-controller.js');
        const results=[];
        for(const [name,limit] of [['pixels',{pixels:1}],['edge',{edge:1}],['bytes',{bytes:1}]]){
          const panel=document.createElement('section');
          panel.style.cssText='position:fixed;left:0;top:0;width:220px;height:220px;background:white';
          panel.innerHTML='<div id="backbone-proposal"><svg xmlns="http://www.w3.org/2000/svg" width="200" height="160"><rect width="200" height="160" fill="blue"/></svg></div>';
          document.body.append(panel);
          const make=tag=>document.createElement(tag),controls=Object.fromEntries(['tools','parking','status','preview','caption'].map(k=>[k,make('div')]));
          for(const k of ['reset','capture','remove'])controls[k]=make('button');
          controls.image=make('img');panel.append(controls.parking);controls.parking.append(controls.tools);
          const source={schemaVersion:'artifact-annotation/v1',artifactId:'limit',revisionId:'limit-revision',designDigest:'limit-digest',selectionId:null};
          const controller=createSnapshotAnnotationController({panel,getCandidates:()=>[{element:panel.querySelector('svg'),identity:source}],
            getView:()=>({...source,capabilities:{annotate:true,capture:true}}),selectArtifact:()=>{},getArtifactLabel:id=>id,controls,
            onPreviewChange:()=>{throw new Error('Limits must not attach a preview')},limits:{bytes:4*1024*1024,pixels:4000000,edge:4096,...limit},
            visibleRegion:visibleDiagramRegion,frameOf:()=>''});
          controller.toggleArtifact('limit');
          while(controller.isCapturing())await new Promise(requestAnimationFrame);
          const editor=[...document.querySelectorAll('.annotation-editor')].at(-1);
          results.push({name,message:editor.querySelector('.annotation-editor-status').textContent,preview:controller.preview()});
          controller.close();panel.remove();
        }
        return results;
      })()`);
      for(const result of limits){
        assert.equal(result.preview,null);
        assert.match(result.message,result.name==='bytes'?/exceeds 4 MiB/:/pixel limit/);
      }
    }
    assert.equal(await browser.evaluate("document.querySelector('.annotation-view-toggle').textContent"),'Annotate');
    await click('.annotation-view-toggle');await open();
    assert.equal(await emptyInk(),true,'A completed annotation never returns as an editable draft.');
    await draw(.35,.45);
    const unfinishedInk=await ink();
    await action('close');
    await click('#annotation-remove');
    assert.equal(await browser.evaluate('testAnnotation.preview()'),null);
    assert.equal(await browser.evaluate("document.querySelector('.annotation-view-toggle').textContent"),'Resume sketch');
    await click('.annotation-view-toggle');await open();
    assert.equal(await ink(),unfinishedInk,'Removing the completed PNG never clears a separate unfinished draft.');
    assert.equal(await browser.evaluate("document.querySelector('[data-annotation-action=\"attach\"]').textContent"),'Attach to composer');
    await action('close');
    assert.deepEqual(posts,[],'No Annotate, Return, Clear, Capture new or Attach operation sends a request.');
    assert.deepEqual(browser.exceptions,[]);
  });
