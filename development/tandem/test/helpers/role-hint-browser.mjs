import assert from "node:assert/strict";

// Runs against the real composer in either the packaged page or project iframe.
export async function exerciseRoleHintDraft({ browser, evaluate, click }) {
  const value = () => evaluate('document.querySelector("#message").value');
  const help = () => evaluate('document.querySelector("#role-hint-help").textContent');
  const quiet = async () => {
    assert.equal(await help(), "");
    assert.equal(await evaluate('document.querySelector("#role-hint-help").getBoundingClientRect().height'), 0);
    assert.equal(await evaluate('document.querySelector("#message").hasAttribute("aria-describedby")'), false);
    assert.equal(await evaluate('document.querySelector("#message").getAttribute("aria-invalid")'), "false");
  };
  await quiet();
  const key = async (key, windowsVirtualKeyCode, modifiers = 0) => {
    for (const type of ["keyDown", "keyUp"]) await browser.call("Input.dispatchKeyEvent",
      { type, key, windowsVirtualKeyCode, modifiers,
        ...(key === "Enter" && type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}) });
  };
  const replace = async text => {
    await click("#message");
    await key("a", 65, 2);
    await browser.call("Input.insertText", { text });
  };
  await replace("@");
  assert.deepEqual(await evaluate('[...document.querySelector("#role-suggestions").children].map(e=>e.textContent)'), ["@designer", "@agent"]);
  await key("ArrowDown", 40); await key("Enter", 13);
  assert.equal(await value(), "@agent ");
  assert.equal(await evaluate('document.querySelector("#role-suggestions").hidden'), true);
  await replace("@des");
  await key("Tab", 9);
  assert.equal(await value(), "@designer ");
  await replace("@ag");
  await click("#role-suggestions-agent");
  assert.equal(await value(), "@agent ");
  assert.equal(await evaluate('document.activeElement.id'), "message");
  await replace("@");
  const geometry = await evaluate(`(() => {
    const list=document.querySelector("#role-suggestions").getBoundingClientRect(), send=document.querySelector("#send").getBoundingClientRect();
    return { visible:list.width>0 && list.height>0, bounded:list.left>=0 && list.right<=innerWidth && list.top>=0 && list.bottom<=innerHeight,
      overlap:list.left<send.right && list.right>send.left && list.top<send.bottom && list.bottom>send.top };
  })()`);
  assert.deepEqual(geometry, { visible: true, bounded: true, overlap: false });
  await key("Escape", 27);
  await evaluate('document.querySelector("#refresh").click()');
  assert.equal(await evaluate('document.querySelector("#role-suggestions").hidden'), true);
  await replace("@designer");
  assert.match(await help(), /Add a message/);
  assert.equal(await evaluate('document.querySelector("#role-hint-help").checkVisibility()'), true);
  assert.equal(await evaluate('document.querySelector("#message").getAttribute("aria-invalid")'), "true");
  assert.equal(await evaluate('document.querySelector("#message").getAttribute("aria-describedby")'), "role-hint-help");
  await key("Escape", 27);
  assert.equal(await value(), "@designer", "Escape does not discard a draft.");
  await key("Enter", 13);
  assert.equal(await value(), "@designer");
  assert.match(await evaluate('document.querySelector("#notice").textContent'), /Add a message/);
  assert.equal(await evaluate('document.querySelector("#message").disabled'), false);

  await replace("@designer @agent Explain.");
  await key("Enter", 13);
  assert.match(await help(), /Use only one/);
  assert.equal(await value(), "@designer @agent Explain.");
  await replace("@designer Explain the current Design.");
  assert.match(await help(), /Preference: @designer.*Router decides/);
  assert.equal(await evaluate('document.querySelector("#role-hint-help").checkVisibility()'), true);
  assert.equal(await evaluate('document.querySelector("#message").getAttribute("aria-invalid")'), "false");
  await evaluate(`window.roleHintAnnouncements = 0; new MutationObserver(() => window.roleHintAnnouncements++)
    .observe(document.querySelector("#role-hint-help"), {childList:true,subtree:true,characterData:true})`);
  await key("End", 35, 2);
  await browser.call("Input.insertText", { text: " More." });
  assert.equal(await evaluate("window.roleHintAnnouncements"), 0, "Typing the body does not repeat the live hint announcement.");
  await evaluate('(() => { const input = document.querySelector("#message"); input.setSelectionRange(input.value.length - 6, input.value.length); })()');
  await key("Backspace", 8);
  await evaluate('document.querySelector("#message").setSelectionRange(1, 9)');
  await browser.call("Input.insertText", { text: "agent" });
  assert.equal(await value(), "@agent Explain the current Design.");
  assert.match(await help(), /Preference: @agent.*Router decides/);
  await evaluate('document.querySelector("#message").setSelectionRange(0, 7)');
  await key("Backspace", 8);
  assert.equal(await value(), "Explain the current Design.");
  assert.doesNotMatch(await help(), /Preference:/);
  await quiet();

  for (const text of ["@planner Explain.", "mail@agent.example", "`@designer example`", "Explain @agent literally."]) {
    await replace(text);
    assert.doesNotMatch(await help(), /Preference:|Use only one|Add a message/);
    await quiet();
  }
  await replace("@agent Explain.");
  await key("End", 35, 2);
  await key("Enter", 13, 8);
  assert.equal(await value(), "@agent Explain.\n", "Shift+Enter inserts a newline.");

  await evaluate('window.roleHintFixtureSubmits = 0; document.querySelector("#composer").addEventListener("submit", () => window.roleHintFixtureSubmits++)');
  await browser.call("Input.imeSetComposition", { text: "composing", selectionStart: 9, selectionEnd: 9 });
  const composing = await value();
  await key("Enter", 13);
  assert.equal(await evaluate("window.roleHintFixtureSubmits"), 0, "IME confirmation Enter must not submit the composer.");
  assert.ok((await value()).startsWith(composing), "The composing draft is retained.");
  await browser.call("Input.insertText", { text: "composed" });
  assert.equal(await evaluate('document.querySelector("#message").disabled'), false);
  await replace("@agent Retain this draft.");
  await evaluate('document.querySelector("#refresh").click()');
  assert.equal(await value(), "@agent Retain this draft.");
  await click("#message");
  await key("a", 65, 2);
  await key("Backspace", 8);
  assert.equal(await value(), "");
  assert.doesNotMatch(await help(), /Preference:/);
  await quiet();
}
