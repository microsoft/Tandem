import assert from "node:assert/strict";

export async function exerciseLatestNavigation({ browser, evaluate, waitFor, grow, attention }) {
  const visible = 'document.querySelector("#newer").checkVisibility()';
  const atLatest = '["messages","state-history"].every(id=>{const e=document.getElementById(id);return e.scrollHeight-e.scrollTop-e.clientHeight<=2})';
  await waitFor('document.querySelector("#messages").scrollHeight>document.querySelector("#messages").clientHeight+200 && document.querySelector("#state-history").scrollHeight>document.querySelector("#state-history").clientHeight+200');
  await waitFor(atLatest);
  assert.equal(await evaluate(visible), false);
  assert.equal(await evaluate('document.querySelector("#newer").getAttribute("aria-controls")'), "messages state-history");
  assert.equal(await evaluate('document.querySelector(".state-history-return")'), null);
  const latest = async () => {
    await browser.call("Page.bringToFront");
    await evaluate('window.focus();document.querySelector("#newer").scrollIntoView({block:"nearest"});document.querySelector("#newer").focus({preventScroll:true})');
    const geometry = await evaluate(`(() => {
      const button=document.querySelector("#newer"),r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      const send=document.querySelector("#send").getBoundingClientRect();
      return {reachable:r.width>0&&r.height>0&&(hit===button||button.contains(hit)),
        overlapsSend:r.left<send.right&&r.right>send.left&&r.top<send.bottom&&r.bottom>send.top};
    })()`);
    assert.deepEqual(geometry, { reachable: true, overlapsSend: false });
    await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13 });
    await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await waitFor(atLatest); await waitFor(`!${visible}`);
  };
  await evaluate('window.retainedTranscript=document.querySelector("#messages").firstElementChild;document.querySelector("#message").value="Retained latest-navigation draft";document.querySelector("#message").dispatchEvent(new Event("input",{bubbles:true}));document.querySelector("#message").setSelectionRange(2,8)');
  for (const ids of [["messages"], ["state-history"], ["messages", "state-history"]]) {
    await evaluate(`${JSON.stringify(ids)}.forEach(id=>{document.getElementById(id).scrollTop=40})`);
    await waitFor(visible);
    const before = await evaluate(`${JSON.stringify(ids)}.map(id=>document.getElementById(id).scrollTop)`);
    await grow();
    await evaluate("new Promise(resolve=>setTimeout(resolve,150))");
    assert.deepEqual(await evaluate(`${JSON.stringify(ids)}.map(id=>document.getElementById(id).scrollTop)`), before);
    await latest();
    await grow(); await waitFor(atLatest);
  }
  // Late content reflow and viewport changes must not depend on an incoming message.
  await evaluate('document.querySelector("#messages").scrollTop=40;document.querySelector("#state-history").scrollTop=40');
  await waitFor(visible);
  const before = await evaluate('["messages","state-history"].map(id=>document.getElementById(id).scrollTop)');
  await evaluate('document.querySelector("#messages").lastElementChild.style.minHeight="700px";document.querySelector("#state-history").lastElementChild.style.minHeight="150px"');
  await browser.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 520, deviceScaleFactor: 1, mobile: false });
  await evaluate("new Promise(resolve=>setTimeout(resolve,150))");
  assert.deepEqual(await evaluate('["messages","state-history"].map(id=>document.getElementById(id).scrollTop)'), before);
  await latest();
  await evaluate('document.querySelector("#messages").lastElementChild.style.minHeight="900px";document.querySelector("#state-history").lastElementChild.style.minHeight="200px"');
  await waitFor(atLatest);
  await attention(true);
  await waitFor('!document.querySelector("#show-questions").disabled && document.querySelector("#access-approval").checkVisibility()');
  await evaluate('document.querySelector("#show-questions").click()');
  await waitFor('!document.querySelector("#question-panel").hidden');
  await evaluate(`(() => {const answer=document.querySelector("#questions-content textarea");
    answer.value="Retained question answer";answer.dispatchEvent(new Event("input",{bubbles:true}));answer.setSelectionRange(3,9)})()`);
  await evaluate('document.querySelector("#messages").scrollTop=40;document.querySelector("#state-history").scrollTop=40');
  await waitFor(visible);
  const decisions = await evaluate('document.querySelectorAll("[data-access-decision]").length');
  assert.ok(decisions > 0);
  await latest();
  assert.equal(await evaluate('document.querySelector("#question-panel").hidden'), false);
  assert.deepEqual(await evaluate('(()=>{const e=document.querySelector("#questions-content textarea");return [e.value,e.selectionStart,e.selectionEnd]})()'),
    ["Retained question answer", 3, 9]);
  assert.equal(await evaluate('document.querySelectorAll("[data-access-decision]").length'), decisions);
  assert.deepEqual(await evaluate('(()=>{const e=document.querySelector("#message");return [e.value,e.selectionStart,e.selectionEnd]})()'),
    ["Retained latest-navigation draft", 2, 8]);
  assert.equal(await evaluate('document.querySelector("#messages").firstElementChild===window.retainedTranscript'), true);
  await attention(false);
}
