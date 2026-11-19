import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildRequirementsSkill } from "../src/planning-prompts.js";
import { validateArtifact } from "../development/tandem/public/artifacts/contract.js";
import { browserAvailable, openFixtureBrowser } from "../development/tandem/test/helpers/browser-fixture.mjs";
import { readRequirementsDagChanges } from "../src/requirements-reconciliation.js";
import { applyAuthoritativeAnswer, decisionDescendants, decisionIsReady, validateDecisionGraph, type DecisionNode } from "../src/workflow.js";

const root = fileURLToPath(new URL("../", import.meta.url));

test("the distributed chat instructions exactly match the canonical production builder", async () => {
    const source = buildRequirementsSkill();
    assert.equal(await readFile(join(root, "skills", "requirements", "SKILL.md"), "utf8"), source);
    const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/);
    assert.ok(frontmatter, "The generated artifact remains a standalone skill document.");
    assert.match(frontmatter[1], /^name: requirements$/m);
    assert.match(frontmatter[1], /^license: MIT$/m);
    assert.ok(source.endsWith("\n"));
});

test("chat skill generation detects drift read-only and regenerates the canonical bytes", async t => {
    const fixture = await mkdtemp(join(tmpdir(), "requirements-chat-generation-"));
    t.after(() => rm(fixture, { recursive: true, force: true }));
    await mkdir(join(fixture, "scripts"));
    await mkdir(join(fixture, "src"));
    await mkdir(join(fixture, "skills", "requirements"), { recursive: true });
    const script = join(fixture, "scripts", "build-requirements-skill.ts");
    const skill = join(fixture, "skills", "requirements", "SKILL.md");
    await copyFile(join(root, "scripts", "build-requirements-skill.ts"), script);
    await writeFile(join(fixture, "package.json"), JSON.stringify({ type: "module", version: "9.8.7" }));
    const canonical = buildRequirementsSkill();
    // Fixture bytes come from production; this tests generation, not model behavior.
    await writeFile(join(fixture, "src", "planning-prompts.ts"),
        `export function buildRequirementsSkill() { return ${JSON.stringify(canonical)}; }\n`);
    await writeFile(skill, "stale fixture\n");
    const stale = spawnSync(process.execPath, ["--import", "tsx", script, "--check"], { cwd: root, encoding: "utf8" });
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /SKILL\.md is stale/);
    assert.equal(await readFile(skill, "utf8"), "stale fixture\n", "Check mode never changes a consumer file.");
    execFileSync(process.execPath, ["--import", "tsx", script], { cwd: root });
    assert.equal(await readFile(skill, "utf8"), canonical);
    execFileSync(process.execPath, ["--import", "tsx", script, "--check"], { cwd: root });
});

test("the canonical chat instructions survive an autocrlf checkout without generated-text drift", async t => {
    const fixture = await mkdtemp(join(tmpdir(), "requirements-chat-checkout-"));
    t.after(() => rm(fixture, { recursive: true, force: true }));
    const skill = join(fixture, "skills", "requirements", "SKILL.md");
    await mkdir(join(fixture, "skills", "requirements"), { recursive: true });
    await copyFile(join(root, ".gitattributes"), join(fixture, ".gitattributes"));
    await writeFile(skill, buildRequirementsSkill());
    execFileSync("git", ["init", "--quiet", fixture]);
    const git = (...args: string[]) => execFileSync("git", ["-C", fixture, "-c", "core.autocrlf=true", ...args], { stdio: "pipe" });
    git("add", "--", ".gitattributes", "skills/requirements/SKILL.md");
    await rm(skill);
    git("checkout-index", "--", "skills/requirements/SKILL.md");
    assert.equal(await readFile(skill, "utf8"), buildRequirementsSkill());
});

const exampleGraphs = () => [...buildRequirementsSkill().matchAll(/```mermaid\n([\s\S]*?)\n```/g)].map(match => match[1]);

test("the complete fictional question DAG plans blocked definitions up front and preserves correction history", () => {
    const skill = buildRequirementsSkill();
    const examples = exampleGraphs();
    assert.equal(examples.length, 3, "Initial planning, a real-answer fixture, and a correction are distinct snapshots.");
    const rows = [...skill.matchAll(/^\| (q_\w+) \| ([^|\r\n]+) \| ([^|\r\n]+) \| ([^|\r\n]+) \| ([^|\r\n]+) \| ([^|\r\n]+) \| yes \|$/gm)];
    assert.equal(rows.length, 8, "All seven initial definitions and one revised definition are disclosed.");
    const definition = (row: RegExpMatchArray) => ({
        id: row[1], title: row[2], dependencies: row[4] === "-" ? [] : row[4].split(", "),
        question: { id: row[1], text: row[2], rationale: row[3], choices: row[5].split("; "),
            recommended: row[6] === "-" ? null : row[6], allowFreeText: true, answerPlaceholder: "" },
    });
    const initial = readRequirementsDagChanges({ nodes: rows.slice(0, 7).map(definition), assumed: [], deferred: [] }).nodes;
    const changed = definition(rows[7]);
    const revised = readRequirementsDagChanges({
        nodes: initial.map(node => node.id === changed.id ? changed : node), assumed: [], deferred: [],
    }).nodes;
    assert.ok(skill.indexOf("| ID | Complete question") < skill.indexOf("```mermaid"));
    const answersFromTable = (heading: string) => Object.fromEntries(skill.slice(skill.indexOf(heading)).split("\n\n")[0]
        .split("\n").slice(2).map(row => row.split(" | ").slice(0, 2).map((cell, index) => index === 0 ? cell.replace(/^\| /, "") : cell)));
    const supplied = answersFromTable("| Decision | Exact answer | Source |");
    const current = answersFromTable("| Decision | Current exact answer | Source |");
    const before = { q_order: "Soonest workshop first", ...supplied };
    const answers = [{ q_order: "Soonest workshop first" }, before, current];
    const asGraph = (definitions: typeof initial, values: Record<string, string>) => ({
        nodes: definitions.map((node): DecisionNode => ({ ...node, answer: values[node.id] ?? null,
            status: values[node.id] ? "answered" : "toAnswer" })),
    });
    const beforeGraph = asGraph(initial, before);
    const affected = decisionDescendants(beforeGraph, "q_payment");
    assert.deepEqual([...affected].sort(), ["q_cancellation", "q_changes", "q_confirmation"]);
    const corrected = applyAuthoritativeAnswer(beforeGraph, asGraph(revised, before), "q_payment", "On arrival", true);
    assert.deepEqual(Object.fromEntries(corrected.nodes.filter(node => node.answer).map(node => [node.id, node.answer])), current);
    for (const id of ["q_confirmation", "q_cancellation"]) {
        assert.ok(skill.includes(`| ${id} | ${before[id]} | Fictional reply 1 | Payment timing changed |`),
            "Invalidated exact answers and their source remain visible, not current approvals.");
    }
    for (const id of ["q_seats", "q_full", "q_order"]) {
        assert.deepEqual(corrected.nodes.find(node => node.id === id), beforeGraph.nodes.find(node => node.id === id));
    }
    assert.notEqual(changed.question.text, initial.find(node => node.id === changed.id)!.question.text);
    assert.notDeepEqual(changed.question.choices, initial.find(node => node.id === changed.id)!.question.choices);
    assert.equal(initial.find(node => node.id === "q_confirmation")!.dependencies.length, 2);
    assert.equal(initial.filter(node => node.dependencies.includes("q_payment")).length, 2);
    assert.equal(initial.find(node => node.id === "q_order")!.dependencies.length, 0);
    assert.ok(initial.every(node => !node.dependencies.includes("q_order")), "The independently answered branch stays independent.");

    const labels = examples.map(source => new Map([...source.matchAll(/^\s*(q_\w+)\["([^"<>`\r\n]+)"\]$/gm)]
        .map(match => [match[1], match[2]])));
    assert.equal([...labels[0].values()].filter(label => label.startsWith("Ready:")).length, 2);
    assert.equal([...labels[0].values()].filter(label => label.startsWith("Blocked:")).length, 4);
    for (const [index, source] of examples.entries()) {
        const definitions = index === 2 ? revised : initial;
        const graph = asGraph(definitions, answers[index]);
        validateDecisionGraph(graph);
        assert.deepEqual([...labels[index].keys()], initial.map(node => node.id), "No lazy addition, hidden descendant, scope node or renumbering.");
        const focusId = ["q_payment", "q_changes", "q_confirmation"][index];
        assert.deepEqual([...source.matchAll(/^\s*class (\w+) focus$/gm)].map(match => match[1]), [focusId]);
        assert.ok(decisionIsReady(graph.nodes.find(node => node.id === focusId)!, graph.nodes));
        for (const node of graph.nodes) {
            const ready = decisionIsReady(node, graph.nodes);
            const reviewing = index === 2 && ["q_confirmation", "q_cancellation"].includes(node.id);
            const status = node.answer ? "Answered" : reviewing ? ready ? "Review ready" : "Review blocked" : ready ? "Ready" : "Blocked";
            assert.equal(labels[index].get(node.id), `${status}: ${node.question!.text}${node.id === focusId ? " - FOCUS" : ""}`);
            if (node.answer) assert.ok(node.dependencies.every(id => Boolean(answers[index][id])));
        }
        assert.equal([...labels[index].values()].filter(label => /FOCUS$/.test(label)).length, 1);
        assert.match(source, /^\s*classDef focus stroke:#[0-9a-f]{6},stroke-width:4px$/m);
        assert.equal(validateArtifact({ schemaVersion: "artifact/v1", format: "mermaid", id: `requirements-example-${index}`,
            title: "Fictional requirements iteration", source, width: 900, height: 650 }).source, source);
        assert.deepEqual([...source.matchAll(/^\s*(\w+)\s+(---|-->)\|(\w+)\|\s+(\w+)$/gm)].map(match => match.slice(1)), [
            ...definitions.flatMap(node => node.dependencies.map(parent => [parent, "-->", "prerequisite", node.id])),
        ]);
    }
});

test("hand-authored chat examples parse and render with the existing Mermaid bundle, not a model-quality evaluation", {
    skip: !browserAvailable, timeout: 30000,
}, async t => {
    const vendor = await readFile(new URL("../development/tandem/public/artifacts/vendor/mermaid.js", import.meta.url));
    const server = createServer((request, response) => {
        if (request.url === "/") {
            response.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><title>Mermaid example validation</title><body></body>");
        } else if (request.url === "/mermaid.js") {
            response.writeHead(200, { "Content-Type": "text/javascript" }).end(vendor);
        } else response.writeHead(404).end();
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close(error => error ? reject(error) : resolve());
    }));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const browser = await openFixtureBrowser(t);
    await browser.call("Network.enable");
    await browser.call("Network.setBlockedURLs", { urls: ["https://*"] });
    await browser.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/` });
    await browser.waitFor('document.title === "Mermaid example validation"');
    const results = await browser.evaluate(`(async () => {
        const {default:mermaid} = await import("/mermaid.js");
        mermaid.initialize({startOnLoad:false,securityLevel:"strict",flowchart:{htmlLabels:false}});
        const results=[];
        for(const [index,source] of ${JSON.stringify(exampleGraphs())}.entries()) {
            const parsed=await mermaid.parse(source);
            const rendered=await mermaid.render("requirements-example-"+index,source);
            const host=document.createElement("div");
            host.innerHTML=rendered.svg;
            document.body.append(host);
            const focus=host.querySelector("g.node.focus");
            const shape=focus?.querySelector("rect");
            results.push({
                parsed:Boolean(parsed),svg:Boolean(host.querySelector("svg")),nodes:host.querySelectorAll("g.node").length,
                focusCount:host.querySelectorAll("g.node.focus").length,
                focusText:/FOCUS/.test(focus?.textContent ?? ""),
                focusedStatus:focus?.textContent.match(/(Ready|Review ready):/)?.[1],
                strokeWidth:shape ? getComputedStyle(shape).strokeWidth : null
            });
            host.remove();
        }
        return results;
    })()`);
    assert.deepEqual(results, [
        { parsed: true, svg: true, nodes: 7, focusCount: 1, focusText: true, focusedStatus: "Ready", strokeWidth: "4px" },
        { parsed: true, svg: true, nodes: 7, focusCount: 1, focusText: true, focusedStatus: "Ready", strokeWidth: "4px" },
        { parsed: true, svg: true, nodes: 7, focusCount: 1, focusText: true, focusedStatus: "Review ready", strokeWidth: "4px" },
    ]);
    assert.deepEqual(browser.exceptions, []);
    t.diagnostic("Hand-authored example/passive-parser/render checks only; no model run or universal host-rendering qualification.");
});
