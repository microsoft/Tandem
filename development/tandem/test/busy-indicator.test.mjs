import assert from "node:assert/strict";
import test from "node:test";
import { browserAvailable } from "./helpers/browser-fixture.mjs";
import { humanLoopUiFixture } from "./helpers/human-loop-ui-fixture.mjs";

test("Working and Stopping use clear static reduced-motion glyphs and animate only when motion is allowed",
  { skip: !browserAvailable, timeout: 60_000 }, async t => {
    const f = await humanLoopUiFixture(t);
    const sample = () => f.evaluate(`(()=>{
      const icon=document.querySelector('.current-state-icon'),style=getComputedStyle(icon),before=getComputedStyle(icon,'::before');
      return {state:icon.closest('.conversation-state-strip').dataset.state,hidden:icon.getAttribute('aria-hidden'),
        label:document.querySelector('#current-state-title').textContent,live:icon.closest('[role=status]').getAttribute('aria-live'),
        animation:style.animationName,transform:style.transform,count:icon.getAnimations().length,
        border:style.borderTopWidth,radius:style.borderRadius,width:style.width,shadow:before.boxShadow,
        pseudo:before.content};
    })()`);
    for (const media of ["no-preference", "reduce"]) {
      await f.browser.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: media }] });
      for (const status of ["working", "stopping", "ready", "waiting-answer", "waiting-permission", "execution-unknown", "closed"]) {
        f.setStatus(status);
        await f.until(`document.querySelector('.conversation-state-strip').dataset.state==='${status}'`);
        await new Promise(done => setTimeout(done, 70));
        const first = await sample();
        await new Promise(done => setTimeout(done, 250));
        const second = await sample();
        assert.equal(first.hidden, "true");
        assert.equal(first.live, "polite");
        assert.ok(first.label);
        if (media === "no-preference" && ["working", "stopping"].includes(status)) {
          assert.equal(first.animation, "state-turn");
          assert.equal(first.count, 1);
          assert.notEqual(first.transform, second.transform);
        } else {
          assert.equal(first.animation, "none");
          assert.equal(first.count, 0);
          assert.equal(first.transform, second.transform);
        }
        if (media === "reduce" && status === "working") {
          assert.equal(first.border, "0px");
          assert.equal(first.radius, "0px");
          assert.notEqual(first.shadow, "none", "Reduced-motion Working is a static ellipsis, not an outlined frozen ring.");
          assert.equal(first.label, "Development needs attention", "A bare fixture status without an active request cannot claim execution.");
        }
        if (media === "reduce" && status === "stopping") {
          assert.equal(first.border, "0px");
          assert.equal(first.radius, "1px");
          assert.equal(first.width, "8px", "Reduced-motion Stopping is a static stop square.");
          assert.equal(first.label, "Development needs attention");
        }
      }
    }
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.browser.exceptions, []);
  });
