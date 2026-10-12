import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { state } from "./helpers/react-harness.js";
import { browserAvailable, openFixtureBrowser } from "../stage2/tandem/test/helpers/browser-fixture.mjs";

test("defaults mouse activation stays on its button when focus leaves the answer form",
    { skip: !browserAvailable, timeout: 60_000 }, async t => {
        const value = state("requirements");
        value.requirements.substage = "dag";
        value.decisionGraph.nodes = [{
            id: "validation", title: "Shared item validation", status: "active", dependencies: [], answer: null,
            question: { id: "validation", text: "Which validation policy should adding and editing share?",
                rationale: "Preserve invalid input and explain how to correct it.",
                choices: ["Trim whitespace, reject empty names and allow duplicates.", "Limit names to 200 characters.", "Reject duplicate names."],
                recommended: "Trim whitespace, reject empty names and allow duplicates.", allowFreeText: true,
                answerPlaceholder: "Override the shared text-validation policy." },
        }];
        const css = (await build({ entryPoints: [fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url))],
            bundle: true, write: false, logLevel: "silent" })).outputFiles[0].text;
        const bundle = await build({ stdin: { contents: `
            import React from "react"; import {createRoot} from "react-dom/client";
            import {App} from "./app.js"; import {StudioStore} from "./state-store.js";
            const store=new StudioStore(); store.accept(await (await fetch("/api/state")).json());
            createRoot(document.getElementById("root")).render(React.createElement(App,{store,version:"pointer-test",connect:false}));
            window.pointerEvidence=[];
            for(const type of ["pointerdown","focusin","pointerup","click"]) document.addEventListener(type,event=>{
                const button=document.querySelector(".all-recommended");
                window.pointerEvidence.push({type,trusted:event.isTrusted,
                    target:event.target.closest("button")?.className??event.target.tagName,
                    top:button?.getBoundingClientRect().top});
            },true);
        `, loader: "tsx", resolveDir: fileURLToPath(new URL("../src/renderer/", import.meta.url)) },
        bundle: true, write: false, platform: "browser", format: "esm", target: "es2022",
        loader: { ".png": "dataurl" },
        define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
        const template = (await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8"))
            .replace("__TANDEM_STYLES__", () => css).replace("__TANDEM_VERSION__", "pointer-test")
            .replace("<script>__TANDEM_CLIENT__</script>", '<script type="module" src="/app.js"></script>');
        let answers = 0;
        const server = createServer((request, response) => {
            if (request.url === "/") { response.setHeader("Content-Type", "text/html"); response.end(template); }
            else if (request.url === "/app.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
            else if (request.url === "/api/project-entry" || request.url === "/api/project-entry/open") {
                response.setHeader("Content-Type", "application/json");
                response.end(JSON.stringify({ projectPath: "C:\\pointer-fixture", startingPath: "preparation", developmentContext: false, developmentStarted: false }));
            }
            else {
                if (request.url === "/api/answer") answers++;
                response.setHeader("Content-Type", "application/json");
                response.end(JSON.stringify(request.url === "/api/state" ? value : { url: "http://127.0.0.1:1/", channel: "pointer-test" }));
            }
        });
        await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
        t.after(() => new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }));
        const browser = await openFixtureBrowser(t);
        const address = server.address(); assert.ok(address && typeof address !== "string");
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
        await browser.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/` });
        await browser.waitFor('Boolean(document.querySelector(".all-recommended"))');
        await browser.waitFor('!document.querySelector("#studio-workspace").inert');
        async function click(selector: string) {
            await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:"center"})`);
            await browser.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
            const point = await browser.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();
                const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
                return {x:r.x+r.width/2,y:r.y+r.height/2,hit:hit===e||e.contains(hit)};})()`);
            assert.ok(point.hit);
            for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
                await browser.call("Input.dispatchMouseEvent", { type, x: point.x, y: point.y,
                    ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
            }
        }
        await click('button[role="radio"][data-state="checked"]');
        await browser.waitFor('document.activeElement.matches("button[role=radio]")');
        await click(".all-recommended");
        t.diagnostic(JSON.stringify(await browser.evaluate('({events:window.pointerEvidence,status:document.querySelector("#design-tree-status").textContent,question:document.querySelector("#question-host").innerText})')));
        await browser.waitFor('Boolean(document.querySelector("[role=alertdialog]"))');
        const events = await browser.evaluate("window.pointerEvidence");
        const down = events.find(event => event.type === "pointerdown" && event.target === "all-recommended");
        const up = events.find(event => event.type === "pointerup" && event.target === "all-recommended");
        assert.ok(down?.trusted && up?.trusted, JSON.stringify(events));
        assert.equal(up.top, down.top, "Moving focus to defaults must not collapse its preceding answer form.");
        assert.equal(answers, 0, "Opening confirmation is not authorization to submit defaults.");
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
        await browser.waitFor('!document.querySelector("[role=alertdialog]")');
        assert.equal(answers, 0);
        assert.deepEqual(browser.exceptions, []);
    });
