import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { browserAvailable, openFixtureBrowser } from './helpers/browser-fixture.mjs';
import { formatArtifacts } from './fixtures/multi-format.mjs';

for (const format of ['html', 'svg']) test(`${format} isolated capture preserves scaled geometry through nested host scrolling`,
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const server = createServer(async (request, response) => {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (path === '/') {
        response.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html>
          <style>body{margin:20px}#outer{width:420px;height:300px;overflow:auto}
          #panel{width:350px;height:220px;overflow:auto}iframe{border:0;display:block;width:800px;height:480px;transform:scale(.75);transform-origin:0 0}
          #space{height:120px}#frame-box{width:600px;height:360px}</style>
          <div id="outer"><div id="panel"><div id="space"></div><div id="frame-box"></div></div></div>`);
        return;
      }
      if (!['/annotation-capture.js', '/annotation-controller.js', '/annotation-model.js', '/snapshot-annotation-controller.js'].includes(path)) {
        response.writeHead(404).end(); return;
      }
      response.writeHead(200, { 'content-type': 'text/javascript' })
        .end(await readFile(new URL(`../public${path}`, import.meta.url)));
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
    const browser = await openFixtureBrowser(t);
    await browser.call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    await browser.waitFor("document.querySelector('#panel')");
    const artifact = formatArtifacts.find(item => item.format === format);
    const result = await browser.evaluate(`(async () => {
      const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-same-origin');
      const loaded=new Promise(resolve=>frame.onload=resolve);
      frame.srcdoc='<!doctype html><style>html,body{margin:0;width:800px;height:480px;overflow:hidden}</style>'+${JSON.stringify(artifact.source)};
      document.querySelector('#frame-box').append(frame);await loaded;
      const panel=document.querySelector('#panel');panel.scrollTop=130;panel.scrollLeft=70;
      const {visibleDiagramRegion}=await import('/annotation-controller.js');
      const {captureAnnotatedDiagram}=await import('/annotation-capture.js');
      const region=visibleDiagramRegion(frame,panel),bounds=frame.getBoundingClientRect();
      const target=frame.contentDocument.getElementById('${format === 'html' ? 'drink' : 'counter'}').getBoundingClientRect();
      const point={x:Math.round((target.left+target.width*.75)*bounds.width/frame.clientWidth-region.viewport.x),
        y:Math.round((target.top+target.height*.75)*bounds.height/frame.clientHeight-region.viewport.y)};
      const blob=await captureAnnotatedDiagram(frame,region.viewport,[[{x:25,y:25},{x:35,y:35}]]);
      const image=new Image(),url=URL.createObjectURL(blob);image.src=url;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const context=canvas.getContext('2d');context.drawImage(image,0,0);URL.revokeObjectURL(url);
      return {width:image.width,height:image.height,region:region.viewport,point,
        color:[...context.getImageData(point.x,point.y,1,1).data],
        stroke:[...context.getImageData(30,30,1,1).data],
        source:frame.contentDocument.getElementById('${format === 'html' ? 'drink' : 'counter'}').outerHTML};
    })()`);
    assert.equal(result.width, result.region.width);
    assert.equal(result.height, result.region.height);
    assert.ok(result.region.x > 0 && result.region.y > 0, 'Both host scroll axes crop the zoomed artifact');
    assert.ok(result.point.x > 0 && result.point.x < result.width);
    assert.ok(result.point.y > 0 && result.point.y < result.height);
    assert.deepEqual(result.color, [224, 48, 48, 255]);
    assert.deepEqual(result.stroke, [228, 93, 52, 255]);
    assert.doesNotMatch(result.source, /data-capture-pseudo/);
    assert.deepEqual(browser.exceptions, []);
  });
