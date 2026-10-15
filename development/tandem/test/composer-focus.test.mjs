import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { browserAvailable } from "./helpers/browser-fixture.mjs";
import { humanLoopUiFixture } from "./helpers/human-loop-ui-fixture.mjs";

test("composer focus ring stays inside its text box beside Send without clipping long drafts",
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
        await f.click("#message");
        await f.evaluate(`document.querySelector("#message").setSelectionRange(5,12);
          document.querySelector("#message").scrollTop=0`);
        const geometry = await f.evaluate(`(() => {
          const input=document.querySelector("#message"),send=document.querySelector("#send");
          const r=input.getBoundingClientRect(),s=send.getBoundingClientRect(),style=getComputedStyle(input);
          const outline=parseFloat(style.outlineWidth),offset=parseFloat(style.outlineOffset),extension=outline+offset;
          return {input:r.toJSON(),send:s.toJSON(),outline,offset,color:style.outlineColor,
            ringRight:r.right+extension,ringLeft:r.left-extension,
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
        assert.deepEqual([geometry.start, geometry.end, geometry.text], [5, 12, text]);
        assert.equal(geometry.horizontalOverflow, false);
        assert.equal(geometry.verticalScroll, true);
      }
    }
    for (const measured of measurements) {
      assert.ok(measured.outline >= 2 && measured.offset <= -measured.outline,
        `The complete focus ring belongs inside the text box, not under Send: ${JSON.stringify(measured)}`);
      assert.ok(measured.ringRight <= measured.send.left);
      assert.ok(measured.paddingLeft >= 4 && measured.paddingRight >= 4);
    }
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.browser.exceptions, []);
  });
