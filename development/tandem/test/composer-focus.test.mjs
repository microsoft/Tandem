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
