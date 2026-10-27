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
    const [css, shared, layout] = await Promise.all(["../src/renderer/styles.css", "../development/tandem/public/ui-system.css",
        "../src/renderer/ui/layout.css"]
        .map(path => readFile(new URL(path, import.meta.url), "utf8")));
    assert.match(css, /container:\s*output\s*\/\s*inline-size/);
    assert.match(css, /@container output \(max-width: 680px\)/);
    assert.match(css, /g\.node\[data-selectable="true"\]:focus-visible\s*\{\s*outline:\s*3px solid/);
    assert.match(css, /\.workspace\[data-context-open="true"\] \.requirements\s*\{\s*display: block/);
    assert.match(shared, /\.tandem-tab-list\s*\{[^}]*overflow-x: auto/);
    assert.match(css, /\.preview\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    assert.match(css, /\.prototype-view \.frame-wrap\s*\{[^}]*grid-template-rows:\s*minmax\(220px, 1fr\) auto/);
    assert.match(layout, /form:not\(\.feedback-composer\):focus-within textarea\.tandem-input\.composer-input/);
    assert.doesNotMatch(css, /animation:\s*next-action/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.processing-indicator/);
});

test("navigation headers and below-input actions retain bounded independent layout", async () => {
    const css = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    const header = css.match(/\.previewbar\s*\{([^}]+)\}/)![1];
    const actions = css.match(/\.phase-actions\s*\{([^}]+)\}/)![1];
    assert.match(header, /flex-wrap:\s*wrap/);
    assert.match(actions, /margin-inline-start:\s*auto/);
    assert.match(actions, /justify-content:\s*flex-end/);
    assert.match(actions, /max-width:\s*100%/);
    assert.doesNotMatch(header + actions, /border(?:-bottom|-top)?:/);
    assert.match(css, /\.stage-input-review\s*\{[^}]*grid-row:\s*3;[^}]*overflow:\s*auto/);
    assert.match(css, /\.project-workspace > \.preview > \.previewbar\s*\{\s*grid-row:\s*1/);
    assert.match(css, /\.project-workspace > \.preview > \[role="tabpanel"\]\s*\{\s*grid-row:\s*2/);
});

test("compact density is shared by all stage headers, panels, controls, and composers", async () => {
    const [css, theme, layout] = await Promise.all(["../src/renderer/styles.css", "../development/tandem/public/project-theme.css",
        "../src/renderer/ui/layout.css"].map(path => readFile(new URL(path, import.meta.url), "utf8")));
    const rules = (selector: string, source = css) => {
        const start = source.search(new RegExp("^" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{", "m"));
        assert.ok(start >= 0, `Missing ${selector}`);
        return source.slice(start, source.indexOf("}", start));
    };
    for (const [token, size] of [["space", 8], ["card-padding", 10], ["control-height", 30], ["tab-height", 36]]) {
        assert.match(theme, new RegExp(`--studio-${token}:\\s*${size}px`));
    }
    for (const token of ["small-control-height", "composer-height"]) {
        assert.match(theme, new RegExp(`--studio-${token}:\\s*var\\(--studio-control-height\\)`),
            "Compact controls and composers share the approved control-height token.");
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
    assert.match(rules("form textarea.composer-input"), /height:\s*var\(--studio-composer-height\)/);
    assert.match(rules("#question-host:focus-within textarea.composer-input"), /var\(--studio-composer-expanded-height\)/);
    assert.match(rules(".start-form textarea.composer-input"), /min-height:\s*112px/);
    assert.match(rules(".tandem-input.composer-input", layout), /min-height:\s*var\(--studio-composer-height\)/);
    assert.match(rules(".artifact-content"), /line-height:\s*1\.55/);
    assert.match(rules(".requirements"), /padding-inline-end:\s*4px/);
    assert.match(rules(".requirements"), /scrollbar-width:\s*thin/);
    assert.match(rules(".requirements"), /scrollbar-gutter:\s*stable/);
    assert.match(rules(".splitter"), /min-width:\s*5px/);
    assert.match(rules(".splitter:focus-visible"), /outline:\s*2px solid var\(--studio-focus\)/);
});

test("desktop activity bar keeps completion visible as an icon-only action", async () => {
    const css = await readFile(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    const desktop = css.slice(css.indexOf("@media (min-width: 761px)"), css.indexOf("\n.splitter {"));
    assert.match(desktop, /\.workflow-section > :not\(\.stage-list\):not\(#complete-stage\)/);
    assert.match(desktop, /\.complete-stage-label\s*\{\s*display:\s*none/);
    assert.match(desktop, /#complete-stage\s*\{[^}]*height:\s*44px;[^}]*padding:\s*0;[^}]*gap:\s*0/);
    assert.match(desktop, /#complete-stage\s*\{[^}]*background:\s*var\(--studio-action-bg\);[^}]*color:\s*var\(--color-white, #fff\)/);
    assert.match(desktop, /#complete-stage:disabled\s*\{\s*opacity:\s*\.5/);
    assert.doesNotMatch(css.slice(0, css.indexOf("@media (min-width: 761px)")), /\.complete-stage-label/);
    assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test("compact theme preserves host colors, standalone dark mode, and accessible input variants", async () => {
    const css = (await Promise.all(["../src/renderer/styles.css", "../development/tandem/public/project-theme.css"]
        .map(path => readFile(new URL(path, import.meta.url), "utf8")))).join("\n");
    assert.match(css, /--studio-surface:\s*var\(--background-color-default,\s*light-dark\(/);
    assert.match(css, /--studio-text:\s*var\(--text-color-default,\s*light-dark\(/);
    assert.match(css, /--studio-muted:\s*var\(--text-color-muted,\s*color-mix\(in srgb,\s*var\(--studio-text\)/);
    assert.match(css, /:root\[data-color-mode="dark"\][^{]*\{\s*color-scheme:\s*dark/);
    assert.match(css, /:root\[data-color-mode="light"\][^{]*\{\s*color-scheme:\s*light/);
    assert.match(css, /@media \(pointer: coarse\)[\s\S]*?--studio-control-height:\s*44px/);
    assert.match(css, /@media \(forced-colors: active\)/);
    assert.match(css, /\.choice\[data-state="checked"\][^{]*\{[^}]*background:\s*var\(--studio-accent-soft\)/);
    assert.match(css, /\.usage-intake\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/);
    assert.match(css, /\.requirements-usage-panel\s*\{[^}]*overflow:\s*auto/,
        "Usage history scrolls in its own tab instead of shrinking the DAG");
    assert.match(css, /\.requirements-dag-panel\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden/,
        "The DAG uses the remaining tab space without an outer scrollbar");
    assert.match(css, /\.reload-status:not\(\[data-status="error"\]\)/, "Compact headers must not hide reload errors");
    assert.doesNotMatch(css, /var\(--(?:text-color-default|text-color-muted|background-color-default),\s*#[\da-f]+\)/i);
});

test("renderer asset injection does not interpret dollar substitution sequences", async () => {
    const source = (await readFile(new URL("../src/renderer.ts", import.meta.url), "utf8")).replace(/^import .+;\r?$/gm, "");
    const code = (await transform(source + "\nglobalThis.render = renderTandemHtml;", { loader: "ts", format: "cjs" })).code;
    const payload = "$& $$ $` $'";
    const context: any = { module: { exports: {} }, styles: payload, clientScript: payload, htmlTemplate: "__TANDEM_STYLES__ | __TANDEM_CLIENT__ | v__TANDEM_VERSION__",
        readBrowserDevelopmentAssets: () => undefined };
    runInNewContext(code, context);
    assert.equal(context.render("0.0.0-test"), payload + " | " + payload + " | v0.0.0-test");
    context.readBrowserDevelopmentAssets = () => ({
        renderer: { template: "__TANDEM_STYLES__ / __TANDEM_CLIENT__ / __TANDEM_VERSION__", styles: "new styles", script: "new </script>" },
    });
    assert.equal(context.render("0.0.1-test"), "new styles / new <\\/script> / 0.0.1-test");
});
