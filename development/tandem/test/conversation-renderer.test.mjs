import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderConversationEntry, renderStateMarker } from "../public/renderers/conversation.js";

function documentFixture() {
  const document = {
    createTextNode: (textContent) => ({ textContent }),
    createElementNS(namespace, tagName) { return { ...this.createElement(tagName), namespaceURI: namespace }; },
    createElement(tagName) {
      return {
        tagName, ownerDocument: document, dataset: {}, style: {}, children: [], attributes: {}, listeners: {},
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; },
        setAttribute(key, value) { this.attributes[key] = value; },
        addEventListener(name, listener) { this.listeners[name] = listener; },
      };
    },
  };
  return document;
}

const descendants = node => [node, ...(node.children ?? []).flatMap(descendants)];
const textOf = node => node.textContent ?? (node.children ?? []).map(textOf).join('');

test("assistant Markdown renders without changing originals, while user and Host text remain literal", () => {
  const document = documentFixture();
  const text = "  Original text\n\n<script>not HTML</script>  ";
  const entry = {
    id: "session:a", kind: "assistant", timestamp: "2026-09-10T00:00:00Z", text,
  };
  const article = renderConversationEntry(document, entry);
  assert.equal(article.children[0].children.find(({ tagName }) => tagName === "strong").textContent, "Copilot");
  assert.equal(article.children[0].children.find(({ className }) => className === "conversation-avatar").textContent, "T");
  assert.match(textOf(article.children[1]), /Original text.*<script>not HTML<\/script>/s);
  assert.equal(descendants(article.children[1]).some(node => node.tagName === "script"), false);
  assert.equal(article.children[1].innerHTML, undefined);
  assert.equal(entry.text, text);
  const userText = "  **My exact draft**\n\n" + text;
  const user = renderConversationEntry(document, { ...entry, id: "user", kind: "user", text: userText });
  assert.equal(textOf(user.children[1]), userText);
  assert.equal(user.children[1].dataset.markdown, undefined);
  const status = renderConversationEntry(document, {
    id: "event:1", kind: "status", timestamp: "2026-09-10T00:00:00Z", text: "Design published",
  });
  assert.equal(status.children[0].children.find(({ tagName }) => tagName === "strong").textContent, "Workflow");
  assert.equal(status.children[0].children.find(({ className }) => className === "conversation-role").textContent, "Host update");
  assert.equal(status.children[0].children.find(({ className }) => className === "conversation-avatar").textContent, "t");
});

test("assistant messages share Markdown tables, emphasis, lists and code with safe navigation only", () => {
  const article = renderConversationEntry(documentFixture(), {
    id: "markdown", kind: "assistant", timestamp: "2026-09-10T00:00:00Z",
    text: "# Choice\n\nUse **Marked** with *care* and `literal()`.\n\n| Need | Source |\n|---|---|\n| Prototype | AKShare |\n\n" +
      "3. Read\n4. Decide\n\n> No automatic build.\n\n```js\n<script>literal()</script>\n```\n\n" +
      "[Docs](https://example.com/docs) https://example.com/plain.\n\n[Unsafe](javascript:alert(1)) " +
      "[Credentials](https://user:password@example.com/) [Relative](/api/runtime/close) ![Alt](https://example.com/image.png)",
  });
  const nodes = descendants(article.children[1]);
  for (const tag of ["h1", "strong", "em", "code", "table", "thead", "tbody", "ol", "blockquote", "pre"])
    assert(nodes.some(node => node.tagName === tag), tag);
  assert.equal(nodes.find(node => node.tagName === "ol").start, 3);
  const links = nodes.filter(node => node.tagName === "a");
  assert.deepEqual(links.map(node => node.href), ["https://example.com/docs", "https://example.com/plain"]);
  assert(links.every(node => node.target === "_blank" && node.rel === "noreferrer noopener"));
  assert.equal(nodes.some(node => ["script", "img", "iframe"].includes(node.tagName)), false);
  assert.match(textOf(article), /Unsafe.*Credentials.*Relative.*Alt/s);
  assert.equal(nodes.find(node => node.tagName === "pre").children[0].textContent, "<script>literal()</script>");
});

test("history buttons only navigate to their exact associated entry and do not own CURRENT", () => {
  const document = documentFixture();
  const focused = [];
  const marker = renderStateMarker(document, {
    id: "state:review-2", entryId: "event:second-review", kind: "working", label: "Reviewing",
    timestamp: "2026-09-10T00:00:00Z", requestId: "request-a",
  }, (id) => focused.push(id));
  const button = marker.children[0];
  assert.equal(button.type, "button");
  button.listeners.click();
  assert.deepEqual(focused, ["event:second-review"]);
  assert.equal(button.attributes["aria-current"], undefined);
  assert.equal(button.children[0].children[0].dataset.historyTone, "structure");
});

test("history tint is applied only to the SVG, preserving labels, circle and navigation", () => {
  const marker = renderStateMarker(documentFixture(), { id: "design", entryId: "design-message",
    kind: "working", label: "Designing" }, () => {});
  const [dot, label] = marker.children[0].children;
  assert.equal(dot.children[0].dataset.historyTone, "design");
  assert.deepEqual(dot.dataset, {});
  assert.equal(label.textContent, "Designing");
  assert.equal(marker.className, "state-history-step state-working");
});
