import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { browserAvailable } from "./helpers/browser-fixture.mjs";
import { humanLoopUiFixture } from "./helpers/human-loop-ui-fixture.mjs";

test("composer focus highlights its existing border beside Send without clipping or resizing long drafts",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const f = await humanLoopUiFixture(t, {
      ...(process.env.QUESTIONS_PACKAGE_PUBLIC ? { publicDirectory: resolve(process.env.QUESTIONS_PACKAGE_PUBLIC) } : {}),
      surface: "browser",
    });
    const text = "LongUnbrokenDraft".repeat(40) + "\nSecond short line";
    const measurements = [];
    for (const [width, height] of [[1893, 1000], [1360, 900], [980, 620], [920, 620], [390, 620], [1360, 480], [390, 480]]) {
      for (const theme of ["light", "dark"]) {
        await f.browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
        await f.evaluate(`document.body.dataset.theme=${JSON.stringify(theme)};
          document.querySelector("#message").value=${JSON.stringify(text)}`);
        const unfocused = await f.evaluate(`(() => {
          const input=document.querySelector("#message");input.blur();
          const r=input.getBoundingClientRect(),style=getComputedStyle(input);
          return {width:r.width,height:r.height,border:style.borderColor,borderWidth:style.borderWidth};
        })()`);
        await f.click("#message");
        await f.evaluate(`document.querySelector("#message").setSelectionRange(5,12);
          document.querySelector("#message").scrollTop=0`);
        const geometry = await f.evaluate(`(() => {
          const input=document.querySelector("#message"),send=document.querySelector("#send");
          const r=input.getBoundingClientRect(),s=send.getBoundingClientRect(),style=getComputedStyle(input);
          return {input:r.toJSON(),send:s.toJSON(),outline:style.outlineStyle,
            border:style.borderColor,borderWidth:style.borderWidth,
            paddingLeft:parseFloat(style.paddingLeft),paddingRight:parseFloat(style.paddingRight),
            horizontalOverflow:input.scrollWidth>input.clientWidth+1,verticalScroll:input.scrollHeight>input.clientHeight,
            focus:document.activeElement===input,start:input.selectionStart,end:input.selectionEnd,text:input.value};
        })()`);
        measurements.push({ width, height, theme, ...geometry });
        if (process.env.COMPOSER_FOCUS_EVIDENCE) {
          await mkdir(process.env.COMPOSER_FOCUS_EVIDENCE, { recursive: true });
          const name = `composer-focus-${width}x${height}-${theme}`;
          await writeFile(join(process.env.COMPOSER_FOCUS_EVIDENCE, `${name}.png`), await f.browser.screenshot());
          await writeFile(join(process.env.COMPOSER_FOCUS_EVIDENCE, `${name}.json`), JSON.stringify(geometry, null, 2));
        }
        assert.equal(geometry.focus, true);
        assert.deepEqual({width:geometry.input.width,height:geometry.input.height,borderWidth:geometry.borderWidth},
          {width:unfocused.width,height:unfocused.height,borderWidth:unfocused.borderWidth});
        assert.notEqual(geometry.border, unfocused.border, "Focus changes the existing border color");
        assert.deepEqual([geometry.start, geometry.end, geometry.text], [5, 12, text]);
        assert.equal(geometry.horizontalOverflow, false);
        assert.equal(geometry.verticalScroll, true);
      }
    }
    for (const measured of measurements) {
      assert.equal(measured.outline, "none", "Focus does not add another outline");
      assert.ok(measured.input.right <= measured.send.left);
      assert.ok(measured.paddingLeft >= 4 && measured.paddingRight >= 4);
    }
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.browser.exceptions, []);
  });

test("composer wrapper closes its right edge and corners independently of the compact Send button",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const f = await humanLoopUiFixture(t, {
      ...(process.env.QUESTIONS_PACKAGE_PUBLIC ? { publicDirectory: resolve(process.env.QUESTIONS_PACKAGE_PUBLIC) } : {}),
      surface: "browser",
    });
    const measurements = [];
    for (const panel of ["standalone", "workspace"]) {
      await f.evaluate(panel === "workspace"
        ? 'document.body.dataset.projectPanel="workspace"; document.body.dataset.projectDesign="false"; document.body.dataset.projectStacked="false"'
        : 'delete document.body.dataset.projectPanel');
      for (const width of [848, 390]) for (const theme of ["light", "dark"]) {
        await f.browser.call("Emulation.setDeviceMetricsOverride", { width, height: 620, deviceScaleFactor: 1, mobile: false });
        await f.evaluate(`document.body.dataset.theme=${JSON.stringify(theme)}`);
        for (const draft of ["empty", "focused", "long"]) {
          const text = draft === "long" ? "LongUnbrokenDraft".repeat(40) + "\nSecond line" : "";
          await f.evaluate(`(() => {
            const input=document.querySelector("#message");
            input.value=${JSON.stringify(text)};
            input.dispatchEvent(new Event("input", {bubbles:true}));
            ${draft === "empty" ? "input.blur()" : "input.focus()"};
            input.scrollTop=0;
            document.querySelector("#composer").scrollIntoView({block:"nearest"});
          })()`);
          const geometry = await f.evaluate(`(() => {
            const wrapper=document.querySelector(".command-composer"), input=document.querySelector("#message"),
              send=document.querySelector("#send"), style=getComputedStyle(wrapper), sendStyle=getComputedStyle(send);
            return {wrapper:wrapper.getBoundingClientRect().toJSON(),input:input.getBoundingClientRect().toJSON(),
              send:send.getBoundingClientRect().toJSON(),rightWidth:style.borderRightWidth,rightStyle:style.borderRightStyle,
              leftWidth:style.borderLeftWidth,rightColor:style.borderRightColor,leftColor:style.borderLeftColor,
              topRight:style.borderTopRightRadius,topLeft:style.borderTopLeftRadius,
              bottomRight:style.borderBottomRightRadius,bottomLeft:style.borderBottomLeftRadius,
              paddingRight:parseFloat(style.paddingRight),paddingLeft:parseFloat(style.paddingLeft),
              sendAlign:sendStyle.alignSelf,text:input.value,
              focus:document.activeElement===input,
              rightEdgeHit:document.elementFromPoint(wrapper.getBoundingClientRect().right-.5,
                wrapper.getBoundingClientRect().top+20)===wrapper};
          })()`);
          measurements.push({ panel, width, theme, draft, ...geometry });
          if (process.env.COMPOSER_FOCUS_EVIDENCE && width === 848 && draft === "empty") {
            await mkdir(process.env.COMPOSER_FOCUS_EVIDENCE, { recursive: true });
            const clip = await f.evaluate(`(() => {
              const r=document.querySelector("#composer").getBoundingClientRect();
              return {x:Math.max(0,r.x),y:Math.max(0,r.y),width:r.width,height:r.height,scale:1};
            })()`);
            const image = await f.browser.call("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
            await writeFile(join(process.env.COMPOSER_FOCUS_EVIDENCE, `composer-border-${panel}-${theme}.png`), Buffer.from(image.data, "base64"));
            await writeFile(join(process.env.COMPOSER_FOCUS_EVIDENCE, `composer-border-${panel}-${theme}.json`), JSON.stringify(geometry, null, 2));
          }
        }
      }
    }
    for (const measured of measurements) {
      const context = `${measured.panel} ${measured.width}px ${measured.theme} ${measured.draft}`;
      assert.equal(measured.rightWidth, "1px", context + ": the outer right border is complete");
      assert.equal(measured.rightStyle, "solid", context);
      assert.equal(measured.rightColor, measured.leftColor, context);
      assert.equal(measured.topRight, measured.topLeft, context);
      assert.equal(measured.bottomRight, measured.bottomLeft, context);
      assert.ok(parseFloat(measured.topRight) > 0, context);
      assert.equal(measured.paddingRight, measured.paddingLeft, context);
      assert.ok(measured.input.right < measured.wrapper.right, context);
      assert.equal(measured.rightEdgeHit, true, context);
      assert.ok(measured.wrapper.right <= measured.send.left && measured.send.right <= measured.width, context);
      assert.ok(Math.abs(measured.send.bottom - measured.wrapper.bottom) <= 1, context);
      assert.ok(measured.send.height < measured.wrapper.height, context + ": Send stays compact");
      assert.equal(measured.sendAlign, "end", context);
      assert.equal(measured.focus, measured.draft !== "empty", context);
      assert.equal(measured.text, measured.draft === "long" ? "LongUnbrokenDraft".repeat(40) + "\nSecond line" : "", context);
    }
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.browser.exceptions, []);
  });
