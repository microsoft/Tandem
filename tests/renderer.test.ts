import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import { runInNewContext } from "node:vm";
import "./renderer-sketch.test.js";
import "./renderer-shell.test.js";
import "./renderer-requirements.test.js";
import "./renderer-prototype.test.js";
import "./renderer-panels.test.js";

test("responsive layout and graph keyboard focus have explicit accessible styles", async () => {
    const css = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    assert.match(css, /container:\s*output\s*\/\s*inline-size/);
    assert.match(css, /@container output \(max-width: 680px\)/);
    assert.match(css, /g\.node\[data-selectable="true"\]:focus-visible\s*\{\s*outline:\s*3px solid/);
    assert.match(css, /\.workspace\[data-context-open="true"\] \.requirements\s*\{\s*display: block/);
    assert.match(css, /\.preview-tabs\s*\{[^}]*overflow-x: auto/);
    assert.match(css, /\.preview\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    assert.match(css, /\.prototype-view \.frame-wrap\s*\{[^}]*grid-template-rows:\s*minmax\(220px, 1fr\) auto/);
    assert.match(css, /form:focus-within textarea\[data-speech-input\]/);
    assert.doesNotMatch(css, /animation:\s*next-action/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.processing-indicator/);
});

test("compact density is shared by all stage headers, panels, controls, and composers", async () => {
    const css = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    const rules = (selector: string) => {
        const start = css.indexOf(selector + " {");
        assert.ok(start >= 0, `Missing ${selector}`);
        return css.slice(start, css.indexOf("}", start));
    };
    for (const [token, size] of [["space", 8], ["control-height", 32], ["composer-height", 36]]) {
        assert.match(css, new RegExp(`--studio-${token}:\\s*${size}px`));
    }
    assert.match(rules(".topbar"), /min-height:\s*var\(--studio-header-height\)/);
    assert.match(rules(".previewbar"), /min-height:\s*var\(--studio-tab-height\)/);
    assert.doesNotMatch(css, /\.prototype-view \.(?:topbar|previewbar|mark)\s*\{/);
    for (const selector of [".preparation-panel", ".design-tree-panel", ".design-review-panel",
        ".plan-panel", ".implementation-panel", ".content-panel", ".frame-wrap"]) {
        assert.match(rules(selector), /padding:\s*var\(--studio-space\)/, selector);
    }
    for (const selector of [".preparation-stage-heading", ".design-review-heading", ".plan-heading",
        ".implementation-heading", ".content-heading", ".design-tree-heading"]) {
        assert.match(rules(selector), /padding:\s*var\(--studio-heading-padding\)/, selector);
    }
    assert.match(rules("form textarea[data-speech-input]"), /height:\s*var\(--studio-composer-height\)/);
    assert.match(rules("form:focus-within textarea[data-speech-input]"), /var\(--studio-composer-expanded-height\)/);
    assert.match(rules(".start-form textarea[data-speech-input]"), /min-height:\s*112px/);
    assert.match(rules(".artifact-content"), /line-height:\s*1\.55/);
    assert.match(rules(".requirements"), /padding-inline-end:\s*4px/);
    assert.match(rules(".requirements"), /scrollbar-width:\s*thin/);
    assert.match(rules(".requirements"), /scrollbar-gutter:\s*stable/);
    assert.match(rules(".splitter"), /min-width:\s*9px/);
});

test("renderer asset injection does not interpret dollar substitution sequences", async () => {
    const source = (await readFile(new URL("../src/renderer.ts", import.meta.url), "utf8")).replace(/^import .+;\r?$/gm, "");
    const code = (await transform(source + "\nglobalThis.render = renderTandemHtml;", { loader: "ts", format: "cjs" })).code;
    const payload = "$& $$ $` $'";
    const context: any = { module: { exports: {} }, styles: payload, clientScript: payload, htmlTemplate: "__TANDEM_STYLES__ | __TANDEM_CLIENT__ | v__TANDEM_VERSION__" };
    runInNewContext(code, context);
    assert.equal(context.render("0.0.0-test"), payload + " | " + payload + " | v0.0.0-test");
});
