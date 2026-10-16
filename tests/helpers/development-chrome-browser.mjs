import assert from "node:assert/strict";

export async function exerciseDevelopmentChrome({ browser, evaluate, waitFor, diagnostic, baselineCss = null, baselineProjectCss = null }) {
  for (const [width, height] of [[1893, 900], [1360, 900], [980, 900], [920, 900], [390, 900], [1360, 480], [390, 480]]) {
    await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await waitFor(`(() => {const a=document.querySelector("#design-panel").getBoundingClientRect(),
      b=document.querySelector("#conversation-panel").getBoundingClientRect();
      return innerWidth>660 ? Math.abs(a.top-b.top)<1 : b.top>=a.bottom-1})()`);
    for (const theme of ["light", "dark"]) {
      await evaluate(`document.body.dataset.theme=${JSON.stringify(theme)}`);
      await evaluate("new Promise(resolve=>setTimeout(resolve,100))");
      const metrics = await evaluate(`(() => {
        const panel=document.querySelector("#design-panel"), caption=panel.querySelector(".artifact-heading");
        const toolbar=panel.querySelector(".perspective-toolbar");
        const bounds=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
        const buttons=[...toolbar.querySelectorAll("button")].filter(e=>!e.hidden);
        return { width:innerWidth, height:innerHeight,
          headings:["design-pane-title","conversation-pane-title"].map(id=>{const e=document.getElementById(id);return e.classList.contains("visually-hidden")}),
          named:["design-panel","conversation-panel"].every(id=>document.getElementById(document.getElementById(id).getAttribute("aria-labelledby"))),
          combined:caption.contains(toolbar), duplicateToolbar:!!panel.querySelector(".shared-artifact-view > .perspective-toolbar"),
          designHeading:panel.querySelector(".panel-heading").getBoundingClientRect().height,
          conversationHeading:document.querySelector("#conversation-panel > .panel-heading").getBoundingClientRect().height,
          designContent:document.querySelector("#canvas-scroll").clientHeight,
          conversationContent:document.querySelector("#messages").clientHeight,
          noHorizontalOverflow:document.documentElement.scrollWidth<=innerWidth+1,
          buttons:buttons.map(e=>({label:e.textContent,box:bounds(e),font:parseFloat(getComputedStyle(e).fontSize)})),
          overlaps:buttons.some((a,i)=>buttons.slice(i+1).some(b=>{const x=bounds(a),y=bounds(b);return x.left<y.right&&x.right>y.left&&x.top<y.bottom&&x.bottom>y.top})),
          panel:bounds(panel), title:caption.querySelector(".artifact-heading-title").textContent
        };
      })()`);
      assert.deepEqual(metrics.headings, [true, true]);
      assert.equal(metrics.named, true);
      assert.equal(metrics.combined, true);
      assert.equal(metrics.duplicateToolbar, false);
      assert.equal(metrics.noHorizontalOverflow, true);
      assert.equal(metrics.overlaps, false);
      assert.ok(metrics.designHeading <= 50, JSON.stringify(metrics));
      assert.ok(metrics.conversationHeading <= 90, JSON.stringify(metrics));
      for (const { label, box, font } of metrics.buttons) {
        assert.ok(box.height >= 28 && font >= 12, `${label}: readable usable targets retained`);
        assert.ok(box.left >= metrics.panel.left && box.right <= metrics.panel.right + 1, `${label} clipped: ${JSON.stringify(metrics)}`);
      }
      diagnostic(JSON.stringify({ viewport: `${width}x${height}`, theme, ...metrics }));
      if (baselineCss && baselineProjectCss && theme === "light" && [1893, 1360].includes(width)) {
        // Replay only the prior chrome around the same live content in this owned fixture.
        const before = await evaluate(`(() => {
          const sheets=[...document.styleSheets].filter(s=>s.href?.endsWith("/human-loop-shell.css")||s.href?.endsWith("/project-workspace.css"));
          const theme=sheets.flatMap(s=>[...s.cssRules].filter(r=>r.type===CSSRule.IMPORT_RULE)
            .flatMap(r=>[...r.styleSheet.cssRules].map(rule=>rule.cssText))).join("\\n");
          sheets.forEach(s=>s.disabled=true);
          const style=document.createElement("style");style.textContent=theme+"\\n"+${JSON.stringify(`${baselineCss}\n${baselineProjectCss}`)};document.head.append(style);
          const design=document.querySelector("#design-pane-title"), conversation=document.querySelector("#conversation-pane-title");
          design.classList.remove("visually-hidden");conversation.classList.remove("visually-hidden");
          const wrap=document.createElement("div"), eyebrow=document.createElement("p");eyebrow.className="eyebrow";eyebrow.textContent="Your design";
          design.before(wrap);wrap.append(eyebrow,design);
          const caption=document.querySelector(".artifact-heading"),toolbar=caption.querySelector(".perspective-toolbar"),
            about=caption.querySelector(".artifact-about"),section=caption.closest(".shared-artifact-view");
          section.prepend(toolbar);if(about)section.insertBefore(about,caption.parentElement);
          caption.classList.remove("artifact-heading");
          const result={designContent:document.querySelector("#canvas-scroll").clientHeight,conversationContent:document.querySelector("#messages").clientHeight,
            artifactTop:document.querySelector("[data-artifact-viewport]").getBoundingClientRect().top,
            designHeading:document.querySelector("#design-panel > .panel-heading").getBoundingClientRect().height,
            conversationHeading:document.querySelector("#conversation-panel > .panel-heading").getBoundingClientRect().height};
          caption.classList.add("artifact-heading");caption.append(toolbar);if(about)caption.append(about);
          wrap.before(design);wrap.remove();design.classList.add("visually-hidden");conversation.classList.add("visually-hidden");
          style.remove();sheets.forEach(s=>s.disabled=false);return result;
        })()`);
        const after = await evaluate(`({designContent:document.querySelector("#canvas-scroll").clientHeight,
          conversationContent:document.querySelector("#messages").clientHeight,artifactTop:document.querySelector("[data-artifact-viewport]").getBoundingClientRect().top})`);
        diagnostic(JSON.stringify({ chromeComparison: `${width}x${height}`, before, after,
          designHeightSaved: after.designContent - before.designContent, conversationHeightSaved: after.conversationContent - before.conversationContent,
          artifactTopSaved: before.artifactTop - after.artifactTop }));
        assert.ok(after.designContent > before.designContent && after.conversationContent > before.conversationContent, JSON.stringify({ before, after }));
        assert.ok(after.artifactTop < before.artifactTop, JSON.stringify({ before, after }));
      }
    }
  }
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate('document.querySelector("[data-artifact-expand]").focus();document.querySelector("[data-artifact-expand]").click()');
  await waitFor('!!document.querySelector("[data-artifact-expanded]")');
  await evaluate('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))');
  await waitFor('!document.querySelector("[data-artifact-expanded]")');
  assert.equal(await evaluate('document.activeElement.hasAttribute("data-artifact-expand")'), true);
  await evaluate('document.querySelector(".raw-toggle").click()');
  assert.equal(await evaluate('document.querySelector("#artifact-raw").hidden'), false);
  await evaluate('document.querySelector(".raw-toggle").click()');
  assert.equal(await evaluate('document.querySelector("#artifact-raw").hidden'), true);
}
