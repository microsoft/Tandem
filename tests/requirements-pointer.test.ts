import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { rendererFixtureScript, state } from "./helpers/react-harness.js";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";
import { curatedDefault } from "../src/workflow.js";

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
        const first = value.decisionGraph.nodes[0];
        value.decisionGraph.nodes.push(
            { ...first, id: "payment", title: "Payment boundary for pickup orders", status: "toAnswer", dependencies: ["validation"],
                question: { ...first.question!, id: "payment", text: "How should pickup orders be paid for?",
                    choices: ["Pay at pickup", "Pay when ordering", "Do not collect payments"], recommended: null } },
            { ...first, id: "confirmation", title: "Pickup confirmation", status: "toAnswer", dependencies: ["payment"],
                question: { ...first.question!, id: "confirmation" } },
            { ...first, id: "jurisdiction", title: "Governing shop jurisdiction", status: "toAnswer", dependencies: ["confirmation"],
                question: { ...first.question!, id: "jurisdiction", recommended: null } },
        );
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
        let submittedDefaults: { nodeId: string; answer: string }[] = [];
        const server = createServer((request, response) => {
            if (request.url === "/") { response.setHeader("Content-Type", "text/html"); response.end(template); }
            else if (request.url === "/app.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].text); }
            else if (request.url === "/api/project-entry" || request.url === "/api/project-entry/open") {
                response.setHeader("Content-Type", "application/json");
                response.end(JSON.stringify({ projectPath: "C:\\pointer-fixture", startingPath: "preparation", developmentContext: false, developmentStarted: false }));
            }
            else if (request.url === "/api/answer") {
                answers++;
                let body = "";
                request.on("data", chunk => { body += chunk; });
                request.on("end", () => {
                    submittedDefaults = JSON.parse(body).defaults;
                    value.decisionGraph.nodes = value.decisionGraph.nodes.map(node => {
                        const answer = curatedDefault(node.question);
                        return { ...node, answer, status: answer ? "answered" : node.id === "payment" ? "active" : "toAnswer" };
                    });
                    value.processing = { action: "apply-defaults", status: "success" };
                    value.revision++;
                    response.setHeader("Content-Type", "application/json");
                    response.end(JSON.stringify(value));
                });
            } else {
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
        await click("#question-host textarea");
        await browser.waitFor('document.activeElement === document.querySelector("#question-host textarea")');
        await click(".all-recommended");
        t.diagnostic(JSON.stringify(await browser.evaluate('({events:window.pointerEvidence,status:document.querySelector("#design-tree-status").textContent,question:document.querySelector("#question-host").innerText})')));
        await browser.waitFor('Boolean(document.querySelector("[role=alertdialog]"))');
        const events = await browser.evaluate("window.pointerEvidence");
        const down = events.find(event => event.type === "pointerdown" && event.target.split(/\s+/).includes("all-recommended"));
        const up = events.find(event => event.type === "pointerup" && event.target.split(/\s+/).includes("all-recommended"));
        assert.ok(down?.trusted && up?.trusted, JSON.stringify(events));
        assert.equal(up.top, down.top, "Moving focus to defaults must not collapse its preceding answer form.");
        assert.equal(answers, 0, "Opening confirmation is not authorization to submit defaults.");
        await browser.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
        await browser.waitFor('!document.querySelector("[role=alertdialog]")');
        assert.equal(answers, 0);
        for (const width of [1440, 760, 400]) {
            await browser.call("Emulation.setDeviceMetricsOverride", { width, height: 1100, deviceScaleFactor: 1, mobile: false });
            await browser.evaluate('document.querySelector("#decision-list").scrollIntoView({block:"center"})');
            const markers = await browser.evaluate(`Array.from(document.querySelectorAll("#decision-list .explicit-answer-badge"),badge=>{
                const box=badge.getBoundingClientRect(), parent=badge.closest("button"), bounds=parent.getBoundingClientRect();
                return {text:badge.textContent, visible:box.width>0&&box.height>0, contained:box.right<=bounds.right&&box.left>=bounds.left,
                    border:getComputedStyle(parent).borderStyle, overflow:parent.scrollWidth>parent.clientWidth};
            })`);
            assert.equal(markers.length, 2);
            assert.ok(markers.every(marker => marker.visible && marker.contained && marker.border === "dashed" && !marker.overflow), JSON.stringify({ width, markers }));
            if (process.env.TANDEM_REQUIREMENTS_SCREENSHOTS) {
                await writeFile(join(process.env.TANDEM_REQUIREMENTS_SCREENSHOTS, `requirements-explicit-${width}.png`), await browser.screenshot());
            }
        }
        await browser.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
        await click(".all-recommended");
        await browser.waitFor('Boolean(document.querySelector("[role=alertdialog]"))');
        assert.match(await browser.evaluate('document.querySelector("[role=alertdialog]").textContent'), /2 questions need an explicit answer/);
        await click('[role="alertdialog"] .plan-button:not(.secondary)');
        await browser.waitFor('document.querySelector("[data-decision-id=payment]").getAttribute("aria-pressed")==="true"');
        await browser.waitFor('document.activeElement===document.querySelector("#question-host textarea")');
        assert.equal(answers, 1);
        assert.deepEqual(submittedDefaults.map(item => item.nodeId), ["validation", "confirmation"]);
        assert.equal(await browser.evaluate('document.querySelectorAll("#question-host [role=radio][data-state=checked]").length'), 0);
        assert.equal(await browser.evaluate('document.querySelector(".all-recommended").disabled'), true);
        if (process.env.TANDEM_REQUIREMENTS_SCREENSHOTS) {
            await writeFile(join(process.env.TANDEM_REQUIREMENTS_SCREENSHOTS, "requirements-explicit-focused.png"), await browser.screenshot());
        }
        await click('[data-decision-id="jurisdiction"]');
        await browser.waitFor('document.querySelector("#design-tree-current").textContent.includes("Ready to answer")');
        assert.equal(await browser.evaluate('document.querySelector("#question-host textarea").disabled'), false);
        assert.equal(await browser.evaluate('document.querySelector("#decision-submit").disabled'), false);
        assert.equal(await browser.evaluate('document.querySelectorAll("#question-host [role=radio][data-state=checked]").length'), 0);
        assert.doesNotMatch(await browser.evaluate('document.querySelector("#question-host").textContent'), /Waiting for prerequisites|cannot answer it yet/);
        assert.equal(answers, 1, "selecting another ready explicit question does not submit it");
        if (process.env.TANDEM_REQUIREMENTS_SCREENSHOTS) {
            await writeFile(join(process.env.TANDEM_REQUIREMENTS_SCREENSHOTS, "requirements-explicit-ready.png"), await browser.screenshot());
        }
        assert.deepEqual(browser.exceptions, []);
    });

test("Requirements radios and answer buttons activate on the first pointer click from an unfocused inspector",
    { skip: !browserAvailable, timeout: 60_000 }, async t => {
        const value = state("requirements");
        value.requirements.substage = "dag";
        const choices = [
            "Allow completion using explicitly labeled simulated item, order-wide sugar, and order-wide milk availability, while identifying real availability as unknown.",
            "Require verified shop availability for items and both order-wide choices even for demonstration completion; otherwise explain why completion is blocked.",
            "Demonstrate available and unavailable items, order-wide sugar choices, or order-wide milk choices using clearly labeled illustrative conditions, blocking completion in unavailable scenarios.",
        ];
        value.decisionGraph.nodes = [{
            id: "availability", title: "Unknown menu availability", status: "active", dependencies: [], answer: null,
            question: { id: "availability",
                text: "When real availability of menu items and the order-wide sugar and milk choices is unknown, what should govern demonstration completion?",
                rationale: "Sugar and milk are selected once for the whole order. Their real availability is unverified.",
                choices, recommended: null, allowFreeText: true,
                answerPlaceholder: "Choose how unknown item, sugar, and milk availability affects demonstration completion." },
        }];
        const [script, styles] = await Promise.all([
            rendererFixtureScript(),
            build({ entryPoints: [fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url))],
                bundle: true, write: false, logLevel: "silent" }),
        ]);
        const template = (await readFile(new URL("../src/renderer/index.html", import.meta.url), "utf8"))
            .replace("__TANDEM_STYLES__", () => styles.outputFiles[0].text).replace("__TANDEM_VERSION__", "pointer-test")
            .replace("<script>__TANDEM_CLIENT__</script>", () => `<script>
                window.__renderMermaid = async () => ({svg:'<svg xmlns="http://www.w3.org/2000/svg"></svg>'});
                ${script.replaceAll("</script", "<\\/script")}
                window.pointerFixture = TandemTest.mount();
                pointerFixture.store.refresh();
                window.firstClickEvents = [];
                for (const type of ["pointerdown", "focusin", "pointerup", "click"]) document.addEventListener(type, event => {
                    const button = event.target.closest("button");
                    window.firstClickEvents.push({type, trusted:event.isTrusted,
                        target:button?.getAttribute("data-ui-key") ?? button?.id ?? event.target.tagName,
                        top:button?.getBoundingClientRect().top,
                        scroll:document.querySelector(".design-tree-inspector")?.scrollTop});
                }, true);
                </script>`);
        const answers: { action?: string; answer?: string }[] = [];
        const server = createServer((request, response) => {
            if (request.url === "/") {
                response.setHeader("Content-Type", "text/html");
                response.end(template);
            } else if (request.url === "/api/project-entry" || request.url === "/api/project-entry/open") {
                response.setHeader("Content-Type", "application/json");
                response.end(JSON.stringify({ projectPath: "C:\\pointer-fixture", startingPath: "preparation",
                    developmentContext: false, developmentStarted: false }));
            } else if (request.url === "/api/answer") {
                let body = "";
                request.on("data", chunk => { body += chunk; });
                request.on("end", () => {
                    answers.push(JSON.parse(body));
                    value.revision++;
                    response.setHeader("Content-Type", "application/json");
                    response.end(JSON.stringify(value));
                });
            } else {
                response.setHeader("Content-Type", "application/json");
                response.end(JSON.stringify(request.url === "/api/state" ? value : {}));
            }
        });
        await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
        t.after(() => new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); }));
        const browser = await openFixtureBrowser(t);
        const address = server.address(); assert.ok(address && typeof address !== "string");
        const failures: object[] = [];
        const actions = [
            { selector: '#question-host [role="radio"] .choice-control', kind: "radio" },
            { selector: '#question-host [role="radio"]:nth-of-type(3) .choice-control', kind: "radio" },
            { selector: "#decision-submit", kind: "validation" },
            { selector: "#decision-submit", kind: "answer" },
            { selector: ".all-recommended", kind: "defaults" },
        ] as const;
        for (const [width, height] of [[1440, 650], [1440, 820], [942, 650], [600, 650], [400, 760]]) {
            await browser.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
            for (const { selector, kind } of actions) {
                value.decisionGraph.nodes[0].question!.recommended = kind === "answer" || kind === "defaults" ? choices[0] : null;
                await browser.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/` });
                await browser.waitFor('Boolean(document.querySelector("#decision-submit")) && !document.querySelector("#studio-workspace").inert');
                await browser.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:"center"})`);
                await browser.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
                const submitted = answers.length;
                const revision = value.revision;
                const point = await browser.evaluate(`(() => {
                    const target = document.querySelector(${JSON.stringify(selector)}), rect = target.getBoundingClientRect();
                    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
                    return {x, y, reachable:target.contains(document.elementFromPoint(x, y))};
                })()`);
                assert.equal(point.reachable, true, `${selector} is reachable at ${width}`);
                for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
                    await browser.call("Input.dispatchMouseEvent", { type, x: point.x, y: point.y,
                        ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
                }
                if (kind === "answer") {
                    await browser.waitFor(`pointerFixture.store.getSnapshot().state.revision === ${revision + 1}`);
                }
                await browser.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
                const result = await browser.evaluate(`({
                    selected:document.querySelector(${JSON.stringify(selector)})?.closest('[role="radio"]')?.getAttribute("aria-checked"),
                    error:document.querySelector("#question-host .error")?.textContent,
                    confirmation:Boolean(document.querySelector("[role=alertdialog]")),
                    expanded:document.querySelector("#question-host textarea")?.dataset.composerExpanded === "true",
                    events:window.firstClickEvents
                })`);
                const activated = kind === "radio" ? result.selected === "true"
                    : kind === "validation" ? /Choose an option or enter an answer/.test(result.error)
                        : kind === "defaults" ? result.confirmation
                            : answers.length === submitted + 1 && answers.at(-1)?.answer === choices[0];
                if (!activated || result.expanded) failures.push({ width, height, selector, kind, ...result });
                assert.equal(answers.length, submitted + (kind === "answer" ? 1 : 0),
                    "Only an explicit valid submission sends one answer.");
                if (process.env.TANDEM_REQUIREMENTS_SCREENSHOTS && selector === actions[0].selector) {
                    await writeFile(join(process.env.TANDEM_REQUIREMENTS_SCREENSHOTS,
                        `requirements-first-click-${width}-${height}.png`), await browser.screenshot());
                }
            }
        }
        assert.equal(failures.length, 0, JSON.stringify(failures));
        assert.deepEqual(browser.exceptions, []);
    });
