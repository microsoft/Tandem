import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";
import { patchUiDesign, renderUiDesignHtml, uiDesignVersion } from "../src/ui-design.js";
import { designOperations, uiDesignFixture } from "./helpers/ui-design-fixture.js";

test("offline preview renders every screen, refreshes the same URL and visibly retains a valid view on errors", {
    skip: !browserAvailable, timeout: 60_000,
}, async t => {
    const root = await mkdtemp(join(tmpdir(), "ui-design-preview-"));
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    const path = join(root, "preview.html");
    const template = await readFile(new URL("../skills/ui-design/preview.html", import.meta.url), "utf8");
    const base = uiDesignFixture();
    await writeFile(path, renderUiDesignHtml(template, { current: base, previous: null }));
    const browser = await openFixtureBrowser(t);
    await browser.call("Network.enable");
    await browser.call("Network.setBlockedURLs", { urls: ["http://*", "https://*"] });
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
    const url = pathToFileURL(path).href;
    await browser.call("Page.navigate", { url });
    await browser.waitFor(`document.querySelector('[data-version="${uiDesignVersion(base)}"]')`);
    const contents = await browser.evaluate(`Array.from(document.querySelectorAll('.surface')).map(surface=>({
        text:surface.shadowRoot.textContent, width:surface.style.width, height:surface.style.height,
        color:getComputedStyle(surface.shadowRoot.querySelector('[data-ui-id="title"]')).color
    }))`);
    assert.equal(contents.length, 3);
    for (const [index, title] of ["Find your next workshop", "Book your place", "Your contact details"].entries()) {
        assert.ok(contents[index].text.includes(title));
        assert.equal(contents[index].width, "960px");
        assert.equal(contents[index].height, "640px");
        assert.equal(contents[index].color, "rgb(38, 38, 38)");
    }
    assert.equal(await browser.evaluate(`document.querySelector('[data-complete]').dataset.complete`), "true");
    await browser.evaluate(`document.querySelector('article[data-screen-id="workshops"] .surface').shadowRoot.querySelector('[data-ui-id="book"]').click()`);
    assert.equal(await browser.evaluate(`document.querySelector('article:not([hidden])').dataset.screenId`), "booking");
    const source = await browser.evaluate(`document.getElementById('ui-design-data').textContent`);
    await browser.evaluate(`const surface=document.querySelector('article[data-screen-id="booking"] .surface').shadowRoot;
        surface.querySelector('input').value='Illustrative only'; surface.querySelector('[data-ui-id="submit"]').click();`);
    assert.equal(await browser.evaluate(`document.getElementById('ui-design-data').textContent`), source);
    assert.equal(await browser.evaluate(`location.href`), url);
    assert.deepEqual(await browser.evaluate(`({local:localStorage.length,session:sessionStorage.length})`), { local: 0, session: 0 });
    await browser.call("Page.bringToFront");
    await browser.evaluate(`document.querySelector('nav[aria-label="Screens"] button[data-screen-id="profile"]').focus()`);
    assert.equal(await browser.evaluate(`document.activeElement.dataset.screenId`), "profile");
    await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13 });
    await browser.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await browser.waitFor(`document.querySelector('article:not([hidden])').dataset.screenId === "profile"`);
    await browser.evaluate(`document.querySelector('nav[aria-label="Screens"] button[data-screen-id="workshops"]').click()`);
    if (process.env.TANDEM_UI_DESIGN_SCREENSHOT) await writeFile(process.env.TANDEM_UI_DESIGN_SCREENSHOT, await browser.screenshot());
    await browser.call("Emulation.setDeviceMetricsOverride", { width: 440, height: 800, deviceScaleFactor: 1, mobile: false });
    await browser.waitFor(`document.querySelector('article:not([hidden]) .frame').getBoundingClientRect().width<440`);
    assert.equal(await browser.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
    assert.equal(await browser.evaluate(`document.querySelector('article:not([hidden])').scrollWidth <= document.querySelector('article:not([hidden])').clientWidth`), true);
    const narrow = patchUiDesign(base, uiDesignVersion(base), designOperations(
        ...base.document.screens.map(({ ui, ...screen }) => ({ op: "upsert-screen", screen: { ...screen, width: 360 } })),
    ), "revision");
    await writeFile(path, renderUiDesignHtml(template, { current: narrow, previous: base }));
    await browser.call("Page.reload", { ignoreCache: true });
    await browser.waitFor(`document.querySelector('[data-version="${uiDesignVersion(narrow)}"]')`);
    if (process.env.TANDEM_UI_DESIGN_SCREENSHOT) await writeFile(
        process.env.TANDEM_UI_DESIGN_SCREENSHOT.replace(/\.png$/, "-narrow.png"), await browser.screenshot());
    const next = patchUiDesign(narrow, uiDesignVersion(narrow), designOperations({
        op: "ui", screenId: "workshops", edit: { op: "update", id: "details", props: { text: "Pottery basics - 2 places remaining" } },
    }), "revision");
    await writeFile(path, renderUiDesignHtml(template, { current: next, previous: narrow }));
    await browser.call("Page.reload", { ignoreCache: true });
    await browser.waitFor(`document.querySelector('[data-version="${uiDesignVersion(next)}"]')`);
    assert.ok(await browser.evaluate(`document.querySelector('.surface').shadowRoot.textContent.includes('2 places remaining')`));
    assert.equal(await browser.evaluate(`location.href`), url);
    const broken = renderUiDesignHtml(template, { current: next, previous: narrow })
        .replace('"current":{"id":"example"', '"current":{"id":"invalid id"');
    await writeFile(path, broken);
    await browser.call("Page.reload", { ignoreCache: true });
    await browser.waitFor(`!document.getElementById('error').hidden && document.querySelector('[data-version="${uiDesignVersion(narrow)}"]')`);
    assert.match(await browser.evaluate(`document.getElementById('error').textContent`), /Showing retained example:3.*not the requested update/);
    assert.deepEqual(browser.exceptions, []);
});
