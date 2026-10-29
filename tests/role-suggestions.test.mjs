import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { installRoleSuggestions } from "../development/tandem/public/role-suggestions.js";
import { installComposerEnter } from "../development/tandem/public/composer-enter.js";
import { parseRoleMention } from "../development/tandem/public/role-hint.js";

function fixture(t) {
  const dom = new JSDOM('<form><div id="roles" role="listbox" hidden></div><textarea></textarea></form>');
  t.after(() => dom.window.close());
  const { document } = dom.window, input = document.querySelector("textarea"), list = document.querySelector("#roles");
  let enabled = true, submits = 0;
  document.querySelector("form").requestSubmit = () => submits++;
  const popup = installRoleSuggestions(input, list, () => enabled);
  installComposerEnter(input, document.querySelector("form"), () => enabled);
  return { input, list, popup, dom, submits: () => submits,
    enabled(value) { enabled = value; popup.refresh(); },
    type(text, caret = text.length) {
      input.focus(); input.value = text; input.setSelectionRange(caret, caret);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    },
    key(key, extra = {}) {
      const event = new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra });
      input.dispatchEvent(event);
      return event;
    },
    release(key) { input.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key })); },
  };
}

test("role popup inserts supported leading tokens without sending or replacing the body", t => {
  const h = fixture(t);
  h.type("@");
  assert.equal(h.list.hidden, false);
  assert.deepEqual([...h.list.children].map(e => e.textContent), ["@designer", "@agent"]);
  h.key("ArrowDown");
  assert.equal(h.input.getAttribute("aria-activedescendant"), "roles-agent");
  assert.equal(h.key("Enter").defaultPrevented, true);
  assert.equal(h.input.value, "@agent ");
  h.key("Enter", { repeat: true });
  assert.equal(h.submits(), 0, "Held insertion Enter must not become Send.");
  h.release("Enter");
  assert.equal(h.list.hidden, true);
  h.type("@des\n  Preserve exact body  ", 4);
  h.key("Tab"); h.release("Tab");
  assert.equal(h.input.value, "@designer\n  Preserve exact body  ");
  assert.equal(h.input.selectionStart, 10);
  assert.deepEqual(parseRoleMention(h.input.value).roleHint, { schemaVersion: "human-role-hint/v1", role: "designer" });
  assert.equal(h.submits(), 0);
  h.type("@ag");
  h.list.children[0].click();
  assert.equal(h.input.value, "@agent ");
  assert.equal(h.dom.window.document.activeElement, h.input);
});

test("popup respects literal text, caret, selection, IME, dismissal and unavailable composition", t => {
  const h = fixture(t);
  for (const text of ["user@agent", "@agent@example.com", " @des", "`@des`", "```\n@des", "@planner", "@Designer", "Discuss @des"]) {
    h.type(text);
    assert.equal(h.list.hidden, true, text);
  }
  h.type("@des body");
  assert.equal(h.list.hidden, true, "Body caret is not a mention trigger.");
  h.type("@des", 0);
  assert.equal(h.list.hidden, true);
  h.type("@des");
  h.key("Escape");
  for (let i = 0; i < 3; i++) h.popup.refresh();
  h.input.dispatchEvent(new h.dom.window.Event("select"));
  assert.equal(h.list.hidden, true, "Polling and unchanged selection never reopen dismissal.");
  assert.equal(h.input.value, "@des");
  h.type("@d");
  assert.equal(h.list.hidden, false);
  h.input.dispatchEvent(new h.dom.window.Event("compositionstart"));
  h.key("Enter", { isComposing: true });
  assert.equal(h.list.hidden, true);
  assert.equal(h.input.value, "@d");
  assert.equal(h.submits(), 0);
  h.input.dispatchEvent(new h.dom.window.Event("compositionend"));
  assert.equal(h.list.hidden, false);
  h.input.setSelectionRange(0, 2); h.input.dispatchEvent(new h.dom.window.Event("select"));
  assert.equal(h.list.hidden, true);
  h.type("@");
  h.enabled(false);
  assert.equal(h.list.hidden, true);
  h.enabled(true);
  assert.equal(h.list.hidden, true, "Readiness polling does not open suggestions.");
  h.input.readOnly = true; h.type("@ag");
  assert.equal(h.list.hidden, true);
  h.input.readOnly = false; h.input.disabled = true; h.type("@des");
  assert.equal(h.list.hidden, true);
});
