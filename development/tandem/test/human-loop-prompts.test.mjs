import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { humanLoopPrompts, validateHumanLoopPrompts } from "../public/prompts/human-loop.js";
import { generationContract } from "../public/sketch/contract.js";
import { artifactRules } from "../public/artifacts/contract.js";
import { designGenerationContract, designReferenceCatalog } from "../public/sketch/design-contract.js";
import { HumanLoopTransport } from "../src/human-loop-transport.mjs";
import { DEFAULT_POLICY } from "../runtime-src/domain/workflow/policy.ts";
import { evaluateWrapper, promptCases, contextHarness } from "./helpers/human-loop-prompt-fixture.mjs";
import { browserAvailable, openFixtureBrowser } from "./helpers/browser-fixture.mjs";

const baseline = JSON.parse(await readFile(new URL("./fixtures/human-loop-prompts.before.json", import.meta.url), "utf8"));
const recoveryContext = "Retained conversation and model-context summaries are context, not current code or Design authority. Read current files and canonical Design as needed. Recovery-retired work is history; only this current task authorizes action, never replay an old queued request or continue an archived cycle automatically.";
const terminalInstruction = "Structured progress is not completion. Submit the exact role result through its terminal tool; valid durable submission completes this role. Native execution, scheduling and cleanup belong to the runtime, not a second Host completion audit. Failed validation permits correction and retry. Do not continue work after an accepted result. Stop after this step prevents a successor at this declared result; immediate Stop and Close use native operations rather than asking you for an extra completion proof.";
const oldTerminalInstruction = "Structured progress is not completion. Submit the exact role result; the Host ends the role after its matching tool completes.";
const nativeRoleInstruction = "Follow this role's responsibilities. Normal Copilot permissions still apply. Reviewer and its scoped children are read-only; other native tools retain their ordinary contracts. Tandem domain tools retain role-specific contracts. Internal plan acceptance is Host provenance, not user approval.";
const oldRoleInstruction = "Use only this role's permitted tools. Internal plan acceptance is Host provenance, not user approval.";
const progressInstruction = humanLoopPrompts.wrapper.find(line => line.startsWith("During longer work,"));
const currentPrompts = () => structuredClone(humanLoopPrompts);
const runtime = await readFile(new URL("../src/human-loop-runtime.mjs", import.meta.url), "utf8");
const transport = await readFile(new URL("../src/human-loop-transport.mjs", import.meta.url), "utf8");
const cases = await promptCases(runtime, { designGenerationContract, designReferenceCatalog, humanLoopPrompts });

test("format and answer-authorization guidance preserve unrelated role instructions", () => {
  const { cooperativeStop, roles, reviewScope, designRules, missingResultRecovery, ...unchanged } = humanLoopPrompts;
  const { roles: oldRoles, designRules: oldDesignRules, ...oldUnchanged } = baseline.prompts;
  assert.deepEqual({ ...unchanged, shared: unchanged.shared.filter(line => !line.startsWith("recordedQuestionAnswers")).slice(0, oldUnchanged.shared.length),
    wrapper: unchanged.wrapper.filter((line) => line !== recoveryContext && line !== progressInstruction)
    .map(line => line === terminalInstruction ? oldTerminalInstruction
      : line === nativeRoleInstruction ? oldRoleInstruction
        : line.startsWith("Keep command permissions separate.") ? "Keep command permissions separate. Do not invent the next user request, delegate, or alter Host state." : line) }, oldUnchanged);
  assert.ok(unchanged.wrapper.includes(recoveryContext));
  assert.ok(unchanged.wrapper.includes(terminalInstruction));
  assert.ok(unchanged.wrapper.includes(nativeRoleInstruction));
  assert.deepEqual(roles.agent.slice(0, oldRoles.agent.length), oldRoles.agent);
  assert.equal(roles.agent.length, oldRoles.agent.length + 1);
  assert.equal(roles.implementer.aggregate.length, oldRoles.implementer.aggregate.length);
  assert.deepEqual(roles.implementer.aggregate.slice(1), oldRoles.implementer.aggregate.slice(1));
  assert.deepEqual(roles.implementer.task.slice(1, 4), oldRoles.implementer.task.slice(1, 4));
  assert.equal(roles.implementer.task.at(-1), "Run the agreed artifact-defined user journeys in the actual software, compare expected and actual outcomes, and fix discrepancies before completion; explicitly report anything you could not test rather than relying on the Reviewer to execute it.");
  assert.match(roles.designer[0], /^Produce applicable candidate artifact purposes by default:/);
  assert.equal(roles.planner.length, oldRoles.planner.length);
  assert.deepEqual(roles.planner.slice(2), oldRoles.planner.slice(2));
  assert.ok(reviewScope.every(line => typeof line === "string"));
  assert.match(roles.planner[1], /forecasts.*not authorization boundaries/);
  assert.match(roles.implementer.task[0], /forecast, not a file authorization boundary/);
  assert.match(roles.reviewer.join("\n"), /forecast deviations.*not automatically findings/);
  for (const index of [1, 4]) assert.ok(roles.router.includes(oldRoles.router[index]));
  assert.match(roles.router[0], /implementation requests propose internal planning.*explicit implementation confirmation/);
  assert.match(unchanged.shared.join("\n"), /required for the next action, not merely important/);
  assert.equal(cooperativeStop, undefined);
  assert.match(missingResultRecovery.join("\n"), /Exception recovery.*SAME active role.*Preserve completed work.*only automatic continuation.*not a new workflow stage/);
  assert.match(terminalInstruction, /valid durable submission completes this role.*not a second Host completion audit/);
  assert.equal(generationContract.rules, humanLoopPrompts.sketchRules);
  for (const rule of designRules) assert.ok(designGenerationContract.rules.includes(rule));
  assert.deepEqual(cases.map(({ name }) => name), baseline.cases.map(({ name }) => name));
});

test("every role receives the explicit advisory continuation and consent distinction", () => {
  const guidance = humanLoopPrompts.shared.find(line => line.includes("Every new advisory question"));
  assert.match(guidance, /unanswered:.*keep-current-design.*specific safe behavior/);
  assert.match(guidance, /not a selected option, user answer, acceptance or implementation\/permission approval/);
  assert.match(guidance, /Recommended option wording alone is not a default/);
  assert.match(guidance, /irreversible action.*security\/data-loss.*blocking/);
  const legacy = humanLoopPrompts.shared.find(line => line.startsWith("Legacy advisory"));
  assert.match(legacy, /original history.*explicit clarification.*Never cancel active work/);
  for (const { name, packet } of cases) {
    const prompt = evaluateWrapper(transport, packet, humanLoopPrompts);
    assert.ok(prompt.includes(guidance), name);
    assert.ok(prompt.includes(legacy), name);
  }
});

test("all roles receive natural public milestone guidance without changing result authority", () => {
  assert.match(progressInstruction, /short, concrete user-facing progress sentence.*meaningful milestones/);
  assert.match(progressInstruction, /Do not expose private reasoning, prompts or credentials/);
  assert.match(progressInstruction, /not completion or verification evidence/);
  assert.match(progressInstruction, /Keep progress separate from terminal tool arguments/);
  for (const { name, packet } of cases) assert.ok(evaluateWrapper(transport, packet, humanLoopPrompts).includes(progressInstruction), name);
  assert.ok(humanLoopPrompts.wrapper.includes(terminalInstruction));
});

test("every effective role receives shared plain-language guidance without changing machine contracts", () => {
  const guidance = humanLoopPrompts.shared.find(line => line.startsWith("Use ordinary words"));
  assert.match(guidance, /short, concrete statements.*what happened, its impact, or the choice needed/);
  assert.match(guidance, /unless it is necessary.*user asks for technical detail/);
  assert.match(guidance, /Where should your data be saved\?.*Save in a file on this computer.*Keep it in this browser only/);
  assert.match(guidance, /another browser.*clearing browser data.*only when true.*do not invent storage behavior/);
  assert.match(guidance, /Updated the screens and the rules for saving your data/);
  assert.match(guidance, /Avoid 'authoritative', 'persistence boundary', 'atomic writes' and 'data coordinator'.*unless the user asks/);
  assert.match(guidance, /required choice-label prefixes.*'Change Design'.*'Change implementation'/);
  assert.match(guidance, /errors, uncertainty and incomplete work honestly.*must not imply success/);
  assert.match(guidance, /Preserve exact machine schemas, identifiers and references.*code and artifacts/);
  for (const { name, packet } of cases) {
    assert.ok(evaluateWrapper(transport, packet, humanLoopPrompts).includes(guidance), name);
  }
  assert.equal(humanLoopPrompts.shared.filter(line => line === guidance).length, 1);
  assert.ok(!JSON.stringify(humanLoopPrompts.roles).includes(guidance));
});

test("canonical agreed Design governs product acceptance without weakening execution or reference boundaries", () => {
  const { planner, implementer, reviewer } = humanLoopPrompts.roles;
  const reviewGuidance = reviewer.join("\n");
  for (const instructions of [planner, implementer.task, implementer.aggregate]) {
    const text = instructions.join("\n");
    assert.match(text, /canonical agreed Design.*outcomes and contracts/);
    assert.match(text, /competing approval contract/);
  }
  assert.match(planner[0], /plan, tasks and acceptance criteria.*complete execution aids/);
  assert.match(planner[1], /missing plan item does not remove a Design requirement/);
  assert.match(planner[1], /baseline must equal code.current.*Design must equal design.binding/);
  assert.match(implementer.aggregate[0], /alone is not product success.*every exact completed task ID/);
  assert.match(reviewer[0], /COMPLETE canonical agreed Design.*backbone.*ownership.*contracts and interactions/);
  assert.match(reviewGuidance, /exact design.binding.*read_cycle_changes.*read_cycle_file.*actual source and dependencies/);
  assert.match(reviewGuidance, /requirements omitted by the plan/);
  assert.match(reviewGuidance, /agreed Design is missing.*disclose.*do not substitute a plan/);
  assert.match(reviewGuidance, /ordinary implementation details.*necessary safeguards.*not automatically findings/);
  assert.match(reviewGuidance, /exact producing designRefs/);
  assert.match(implementer.task[1], /normal command permission gates/);
  assert.match(implementer.task[4], /native view, glob and rg.*apply_patch for source edits/);
  assert.match(implementer.task[4], /context no longer matches.*read that file again.*never blindly retry.*overwrite intervening user edits/);
  assert.doesNotMatch(implementer.task[4], /stale file digest|replace_project_file/);
  assert.match(implementer.task[4], /Protected Host-state or session-ownership failures remain safety failures/);
  assert.match(implementer.aggregate[1], /Do not edit code/);
});

test("effective Reviewer packets have optional bounded scopes and exactly two responsibilities", () => {
  const guidance = humanLoopPrompts.roles.reviewer.join("\n");
  for (const pattern of [
    /exactly two responsibilities/,
    /root Reviewer assistant message visible in Conversation, BEFORE substantive source inspection or any native child launch/,
    /Both goals apply to every scope.*one-item list; do not invent children/,
    /Minimal orientation.*not a completed hidden review.*proceed automatically: no approval gate/,
    /material scope additions.*updated list before starting those added scopes/,
    /Reasoning, private todos and child prompts do not count/,
    /Whole-system backbone is part of conformance, not a third goal/,
    /General bug hunting, test-coverage audits and correctness verification are not Review responsibilities/,
    /Three is a concurrency ceiling, not a mandatory split or total-task limit.*small or cohesive work directly/,
    /fewer than three.*every child applies BOTH goals/,
    /tandem_collect_review_scopes.*awaits the native tandem-review-scopes workflow.*native scheduling runs at most THREE workers concurrently.*no total-three cap.*Do not divide equally by file count/,
    /do not poll, rediscover agents, relaunch failed scopes, or repeat every child review sequentially/,
    /taking over platform\/other actors' responsibilities/,
    /Safe, robust and future-proof are not blanket authorization/,
    /supported simpler alternative when available/,
    /all children failing does not fail the parent.*substantive review unavailable/,
    /failed parent Review.*does not require a successful retry/,
  ]) assert.match(guidance, pattern);
  for (const { name, packet } of cases) {
    const effective = evaluateWrapper(transport, packet, humanLoopPrompts);
    assert.equal(humanLoopPrompts.roles.reviewer.every(line => effective.includes(line)), name.startsWith("reviewer:"), name);
    if (name.startsWith("reviewer:")) {
      assert.match(effective, /questionId linked to its own canonical contextual question/);
      assert.match(effective, /coverage limits separate in verificationLimits/);
      assert.match(effective, /never describe that as no findings or approval/);
      assert.match(effective, /explicit eligible same-session grants remain valid across Planner, Implementer, Reviewer/);
    }
  }
});

test("native shell guidance is role-scoped and distinguishes invocation completion from background lifetime", () => {
  const { roles } = humanLoopPrompts;
  const guidance = roles.agent.find((line) => line.startsWith("Use native powershell"));
  assert.equal(typeof guidance, "string");
  assert.ok(roles.implementer.task.includes(guidance));
  for (const pattern of [
    /does not require an optional label or prohibit native-valid label reuse/,
    /read_powershell and stop_powershell use the actual native handle/,
    /list_powershell to inspect native sessions/,
    /Detached execution requires the native host's explicit user authorization and permissions; never set detach automatically/,
    /sync call returning while its process continues is not command completion/,
    /actual invocation's completion before claiming its outcome/,
    /intentionally async process may outlive the role and does not itself hold the role open/,
    /do not inherit remembered custom per-tool execution grants or bypass denial/,
    /Command use must follow your role instructions; native tool availability does not enforce those responsibilities/,
  ]) assert.match(guidance, pattern);
  const reviewer = roles.reviewer.at(-1);
  assert.match(reviewer, /read_powershell\/list_powershell for existing owned invocations only/);
  assert.match(reviewer, /Read-only tool availability is separate from permission lifetime/);
  assert.match(reviewer, /Do not launch commands, stop processes/);
  assert.match(reviewer, /Once-only approval never becomes remembered consent/);
  for (const instructions of [humanLoopPrompts.wrapper, humanLoopPrompts.shared,
    roles.router, roles.designer, roles.planner, roles.implementer.aggregate, roles.reviewer]) {
    assert.equal(instructions.includes(guidance), false);
  }
  assert.doesNotMatch(JSON.stringify(humanLoopPrompts),
    /run_workflow_command|start_workflow_app|read_workflow_command|read_workflow_apps|stop_workflow_app/);
  for (const { name, packet } of cases) {
    const prompt = evaluateWrapper(transport, packet, humanLoopPrompts);
    assert.equal(prompt.includes(guidance), /^(agent|implementer-task):/.test(name), name);
    assert.equal(prompt.includes(reviewer), name.startsWith("reviewer:"), name);
  }
});

test("Designer chooses relevant familiar purposes before independently choosing safe formats", () => {
  const rules = humanLoopPrompts.designRules.join("\n");
  for (const text of ["user journeys/use cases", "workflow/activity", "state transitions", "sequence interactions",
    "UX screens/wireframes", "ER/data models", "API/data contract tables", "system context/component architecture",
    "deployment/technology stack", "minimal sufficient", "purpose before format", "fields, types, constraints, invariants and errors",
    "Do not invent architecture decisions", "existing contextual question mechanism", "not required tabs"]) {
    assert.ok(rules.includes(text), text);
  }
  assert.match(rules, /Mermaid supports flowchart\/graph.*erDiagram.*classDiagram/);
  assert.doesNotMatch(humanLoopPrompts.roles.designer.join("\n"), /identical boxes\/connections|author sketch-design\/v2/);
});

test("initial Designer guidance reconstructs existing code without inventing intent or a new workflow", () => {
  const instructions = humanLoopPrompts.roles.designer.join("\n");
  for (const pattern of [
    /first explore the current project folder read-only with native glob, rg and view/,
    /absence of canonical Design does not mean an empty repository/,
    /manifests, entry points, source, tests, documentation and configuration/,
    /Exclude dependency\/build output and Tandem's own installed package\/state/,
    /Respect native permissions and content exclusions.*do not read secrets or bypass denied reads/,
    /no product implementation.*normal new-project design approach/,
    /existing canonical Design, preserve it and its stable IDs.*do not regenerate the baseline/,
    /actual current behavior, not an imagined replacement/,
    /Distinguish observed implementation, inferred intent, unresolved contradictions and explicitly requested future changes/,
    /Cite concrete repository paths and symbols.*existing fields, not invented schema fields/,
    /Do not assume existing behavior is correct or desired.*shared contextual questions/,
    /no consequential uncertainty exists.*without manufacturing questions/,
    /do not require every question to be answered before publishing a useful baseline/,
    /disclose the exact coverage limit.*rather than fabricating artifacts/,
    /Do not edit, refactor, install dependencies, run project scripts, initialize Git or reset tracked\/untracked user work/,
    /same Router, planning, implementation and Review flow.*no automatic build or replay/,
  ]) assert.match(instructions, pattern);
  const exploration = humanLoopPrompts.roles.designer.find(line => line.startsWith("For an initial Design,"));
  for (const { name, packet } of cases) {
    assert.equal(evaluateWrapper(transport, packet, humanLoopPrompts).includes(exploration),
      name.startsWith("designer:"), name);
  }
});

test("Designer and shared authoring guidance recommend content-specific visuals without new gates", () => {
  const patterns = [
    /User story: HTML storyboard.*ordered user actions, system responses\/outcomes.*failure\/retry/,
    /UI: HTML mockup.*actual screen layouts and interaction states, not boxes describing screens/,
    /Workflows: Mermaid flowchart\/state\/sequence.*steps, lifecycle or interactions/,
    /Behavioral contracts\/rules: Mermaid sequence for exchanges; HTML decision tables for conditions\/rules\/outcomes/,
    /Data contracts: Mermaid ER\/class diagrams.*entities, fields and relationships; JSON Schema\/OpenAPI.*precise machine\/API specs/,
    /never invented HTTP APIs or persistence/,
    /System: Mermaid grouped architecture.*boundaries\/layers\/components\/dependencies, not generic chains of boxes/,
    /Supporting notes: Markdown, brief\/optional\/secondary, not the recommended primary artifact/,
    /defaults, not mandatory formats, all seven artifacts, counts or new validation gates/,
    /SVG remains valid for precise custom visuals; HTML\/SVG alternatives remain allowed where clearer/,
    /primary artifact stands on its own; never hide essential approval decisions in notes/,
    /unchanged\/historical artifacts, Markdown support.*noteForArtifactId.*legacy visualCompanionId.*do not invent mandatory companions/,
  ];
  const designerCases = cases.filter(({ name }) => ["designer:bound", "designer:unbound"].includes(name));
  assert.ok(designerCases.length > 0);
  for (const text of [humanLoopPrompts.designRules.join("\n"), artifactRules.join("\n"),
    ...designerCases.map(({ packet }) => evaluateWrapper(transport, packet, humanLoopPrompts))]) {
    for (const pattern of patterns) assert.match(text, pattern);
    assert.doesNotMatch(text, /(?:Choose Markdown|markdown) for behavior\/business contracts/);
  }
  const role = humanLoopPrompts.roles.designer.join("\n");
  assert.match(role, /content-specific recommended artifact mapping in designGeneration.rules/);
  assert.match(role, /Markdown is for brief optional supporting notes, not the recommended primary artifact/);
  assert.doesNotMatch(role, /markdown for behavior\/business contracts/);
});

test("Designer assigns optional schema metadata explicitly by purpose without rewriting history", () => {
  const rules = humanLoopPrompts.designRules.join("\n");
  assert.match(rules, /Explicitly assign category.*newly authored or revised artifact\/v1/);
  for (const category of ["user-story", "ui", "experience", "workflows", "contracts-data", "system"]) assert.ok(rules.includes(category));
  assert.match(rules, /independent of format.*never guessed from titles/);
  assert.match(rules, /user goal, ordered user actions\/system responses, outcomes.*failure\/retry/);
  assert.match(rules, /UI: screen layouts, controls and interactions/);
  assert.match(rules, /storyboard with screen thumbnails belongs to User story, not simultaneously UI/);
  assert.match(rules, /UI-free projects need no UI artifacts/);
  assert.match(rules, /experience value is legacy-only/);
  assert.match(rules, /do not rewrite unchanged historical artifacts or shared sketches/);
  assert.match(rules, /additive optional metadata in the validator/);
});

test("Designer defaults product journeys to static storyboards without mandating duplicate views", () => {
  const role = humanLoopPrompts.roles.designer.join("\n");
  const rules = humanLoopPrompts.designRules.join("\n");
  assert.match(role, /Default user-facing product journeys to a visual storyboard/);
  assert.match(rules, /user action, system response and next state or outcome/);
  assert.match(rules, /key error\/retry path when relevant/);
  assert.match(rules, /HTML\/CSS for composed screen\/card journeys/);
  assert.match(rules, /not working app interactivity/);
  assert.match(rules, /Mermaid.*structural or technical relationships or an interaction sequence/);
  assert.match(rules, /who talks to whom, message order, responses and failure paths across people, UI and services/);
  assert.match(rules, /not restricted to backend internals/);
  assert.match(rules, /Customer, Checkout UI, Order service and Payment provider/);
  assert.match(rules, /accepted versus declined alternatives, retained bag and retry/);
  assert.match(rules, /not automatically for every user journey/);
  assert.match(rules, /do not require both a workflow diagram and a duplicate storyboard/);
  for (const phrase of ["concise human-readable labels", "intentional grouping", "restrained consistent palette",
    "clear visual hierarchy", "Avoid vast chains and empty space", "Never add theme configuration"]) {
    assert.ok(rules.includes(phrase), phrase);
  }
});

test("Designer requires applicable candidate coverage and concise optional secondary notes", () => {
  const role = humanLoopPrompts.roles.designer.join("\n");
  const rules = humanLoopPrompts.designRules.join("\n");
  for (const purpose of ["user journey/storyboard", "key screen/interaction designs",
    "workflow/state transitions", "contracts/data relationships", "system responsibilities"]) {
    assert.ok(role.includes(purpose), purpose);
  }
  for (const text of [role, rules]) {
    assert.match(text, /by default/);
    assert.match(text, /strong project-specific reason.*existing Designer summary/);
    assert.match(text, /non-GUI.*no-persistence/i);
    assert.match(text, /arbitrary counts/);
    assert.doesNotMatch(text, /First consider|relevance-based menu|Prioritize visual/);
  }
  assert.match(role, /ordered user actions, system responses and observable outcomes/);
  assert.match(role, /screen gallery or prose specification is not a substitute/);
  assert.match(role, /Combine artifacts when they genuinely cover multiple purposes/);
  assert.match(rules, /responsive variants or prose alone do not constitute a journey/);
  assert.match(role, /optional supporting Markdown note.*primary.*secondary, never mandatory/);
  for (const text of [role, designGenerationContract.rules.join("\n")]) {
    assert.match(text, /user is not required to read supporting notes/);
    assert.match(text, /visual artifact must stand on its own and carry all essential behavior, decisions, and outcomes/);
    assert.match(text, /Notes are optional and must be brief/);
    assert.match(text, /concise/);
    assert.match(text, /essential clarification or rationale not already visible/);
    assert.match(text, /not duplicate visuals or bury approval-critical behavior in prose/i);
  }
  assert.match(role, /only schema-supported note relationships/);
  assert.match(designGenerationContract.rules.join("\n"), /Set noteForArtifactId.*same Design.*JSON Schema or OpenAPI/);
  assert.match(designGenerationContract.rules.join("\n"), /Notes open from the primary artifact, not as competing top-level tabs/);
});

test("Router receives exact original question, option implications and Designer provenance for an answer", async () => {
  const Harness = contextHarness(runtime, { designReferenceCatalog, designGenerationContract, humanLoopPrompts });
  const original = { id: "original", message: "Describe this website.", answers: null,
    status: "completed", questionGatesReleased: false, blockingAnswerRefs: [] };
  const question = { id: "content-readiness", state: "answered", answerRequestId: "answer-only",
    question: "How should those business details be handled when the website is implemented?",
    context: "Some details are missing.", whyItMatters: "The published site must be accurate.",
    importance: "advisory", options: [{ id: "placeholders", label: "Build with clear placeholders", implication: "Draft before launch." }],
    source: { role: "designer", resultId: "design-result", cycleId: null, requestId: original.id, requestIds: [original.id] } };
  const request = { id: "answer-only", message: "Question form submission.", answers: {
    schemaVersion: "human-question-answers/v1",
    answers: [{ questionId: question.id, sourceResultId: question.source.resultId, kind: "option", value: "placeholders" }],
  } };
  const state = { requests: [original, request], activeBatchRequestIds: [request.id], questions: [question],
    cycles: [], handoffs: [] };
  const context = await new Harness({}).context("router", request, null, null,
    { id: "before", digest: "b".repeat(64) }, { binding: { revisionId: null, digest: null }, content: null }, state);
  assert.deepEqual(context.questions, [question]);
  assert.deepEqual(context.request.answers, request.answers);
  assert.deepEqual(context.questionAnswers, [{ question, answer: request.answers.answers[0], originalRequests: [original] }]);
  assert.match(context.instructions.join("\n"), /Source role and an older Design are context, neither automatic authority nor a veto/);
  assert.match(context.instructions.join("\n"), /distinct user request, including a contextual answer that actually requests implementation/);
});

test("historical answer references retain settled choices without admitting queued or rejected answers", async () => {
  const Harness = contextHarness(runtime, { designReferenceCatalog, designGenerationContract, humanLoopPrompts });
  const question = { id: "behavior", state: "answered",
    question: "Which behavior should change?", whyItMatters: "Keep the Design and code consistent.",
    options: [{ id: "design", label: "Change Design - show estimates", implication: "Publish the changed Design.",
      resolutionTarget: "design" }],
    source: { role: "reviewer", resultId: "review-result", requestId: "original", requestIds: ["original"], cycleId: null } };
  const answer = { questionId: question.id, sourceResultId: question.source.resultId, kind: "option", value: "design",
    selectedOption: question.options[0] };
  const history = ["completed", "cancelled", "waiting", "rejected", "retired", "discarded"].map(status => ({
    id: `answer-${status}`, status, answers: { schemaVersion: "human-question-answers/v1", answers: [answer] },
    blockingAnswerRefs: [],
  }));
  const request = { id: "current", status: "active", message: "Implement the current Design.", answers: null };
  const state = { requests: [...history, request], activeBatchRequestIds: [request.id],
    questions: [question], cycles: [], handoffs: [] };
  for (const role of ["planner", "implementer"]) {
    const context = await new Harness({}).context(role, request, null, null,
      { id: "before", digest: "b".repeat(64) }, { binding: { revisionId: null, digest: null }, content: null }, state);
    assert.deepEqual(context.recordedQuestionAnswers, history.slice(0, 2).map(source => ({
      requestId: source.id, requestStatus: source.status, question, answer,
    })));
    assert.deepEqual(context.questionAnswers, []);
  }
});

for (const { name, packet } of cases) test(`controlled prompt preserves boundaries and binds exact format context: ${name}`, async () => {
  const expected = baseline.cases.find((entry) => entry.name === name);
  const prompt = evaluateWrapper(transport, packet, humanLoopPrompts);
  const forecastGuidance = /^(planner|implementer-task|implementer-aggregate|reviewer):/.test(name);
  const nativeAgentGuidance = name.startsWith("agent:");
  if (!name.startsWith("designer:") && !name.startsWith("router:") && !forecastGuidance && !nativeAgentGuidance) {
    assert.equal(packet.binding.inputDigest, expected.inputDigest);
    assert.equal(prompt.replace(`${recoveryContext}\n`, "").replace(terminalInstruction, oldTerminalInstruction), expected.prompt);
  } else {
    assert.notEqual(packet.binding.inputDigest, expected.inputDigest);
    assert.ok(prompt.includes(nativeAgentGuidance ? "Use native powershell" : forecastGuidance ? "canonical agreed Design" : name.startsWith("designer:")
      ? humanLoopPrompts.roles.designer[3] : "distinct user request"));
  }
  assert.equal(JSON.stringify(packet), prompt.split("\n").at(-1));

  // Exercise real send assembly; all SDK, ownership and persistence boundaries are local fixtures.
  const state = { activeRequestId: packet.binding.requestId, stop: null, stops: [], uncertainty: null };
  const owner = { schemaVersion: "human-loop-owner/v1", id: "owner", mainSessionId: "main",
    privateSessionId: "private", workspacePath: process.cwd(), policy: DEFAULT_POLICY };
  const sends = [], dispatches = [];
  const session = {
    sessionId: "private", abort: async () => {}, getEvents: async () => [],
    rpc: {
      name: { set: async () => {} },
      mode: { get: async () => "interactive" },
      metadata: { isProcessing: async () => ({ processing: false }), activity: async () => ({ hasActiveWork: false }) },
      queue: { pendingItems: async () => ({ items: [], steeringMessages: [] }) },
    },
    send: async (options) => { sends.push(options); return "message"; },
  };
  const client = { rpc: { sessions: { save: async () => {} } }, createSession: async (configuration) => {
    assert.equal(Object.hasOwn(configuration, "systemMessage"), false);
    assert.equal(configuration.enableConfigDiscovery, true);
    for (const field of ["availableTools", "excludedTools", "skillDirectories", "disabledSkills", "pluginDirectories", "mcpServers"]) {
      assert.equal(Object.hasOwn(configuration, field), false, `Do not replace native ${field} configuration.`);
    }
    return session;
  } };
  const native = new HumanLoopTransport({
    owner, client,
    workspace: { readSnapshot: async (before) => assert.deepEqual(before, packet.binding.before) },
    store: { load: async () => state, admitTask: async (value) => { state.activeTask = value; },
      dispatch: async (...args) => { dispatches.push(args); return state; } },
    verifyOwnership: async () => {}, authorizeTool: async () => {},
  });

  await native.create();
  await native.send(packet);
  assert.deepEqual(sends, [{ mode: "immediate", agentMode: "interactive", prompt }]);
  assert.deepEqual(dispatches.map((entry) => entry[2]), ["role-input-prepared", "role-acknowledged"]);
});

test("validated JSON is deeply frozen without changing text", () => {
  function frozen(value) {
    if (!value || typeof value !== "object") return;
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) frozen(child);
  }
  frozen(humanLoopPrompts);
  assert.throws(() => { humanLoopPrompts.roles.implementer.task.push("change"); }, TypeError);
  const exact = currentPrompts();
  exact.shared[0] = "  Exact text\nwith whitespace.  ";
  assert.equal(validateHumanLoopPrompts(exact).shared[0], "  Exact text\nwith whitespace.  ");
});

test("strict prompt validation rejects unknown, missing, malformed and unbounded sections", () => {
  for (const path of [[], ["roles"], ["roles", "implementer"]]) {
    for (const mutation of ["missing", "unknown", "null", "array"]) {
      const value = currentPrompts();
      const parent = path.slice(0, -1).reduce((node, key) => node[key], value);
      const node = path.reduce((node, key) => node[key], value);
      if (mutation === "missing") delete node[Object.keys(node)[0]];
      else if (mutation === "unknown") node.extra = ["not allowed"];
      else if (path.length) parent[path.at(-1)] = mutation === "null" ? null : [];
      else continue;
      assert.throws(() => validateHumanLoopPrompts(value), /Human-loop prompts:/);
    }
  }
  const paths = [["wrapper"], ["shared"], ["sketchRules"], ["designRules"], ["cooperativeStop"], ["missingResultRecovery"],
    ...["router", "designer", "planner", "reviewer", "agent"].map((role) => ["roles", role]),
    ["roles", "implementer", "task"], ["roles", "implementer", "aggregate"]];
  for (const path of paths) for (const bad of [null, {}, "text", [], [""], [" \n "], [7], [null], ["x".repeat(8193)], Array(65).fill("x"), Array(1)]) {
    const value = currentPrompts();
    const parent = path.slice(0, -1).reduce((node, key) => node[key], value);
    parent[path.at(-1)] = bad;
    assert.throws(() => validateHumanLoopPrompts(value), /Human-loop prompts:/, path.join("."));
  }
  assert.throws(() => validateHumanLoopPrompts({ ...baseline.prompts, schemaVersion: "unknown" }), /schemaVersion/);
  for (const bad of [null, [], "text", 1]) assert.throws(() => validateHumanLoopPrompts(bad), /Human-loop prompts:/);
});

test("native Node JSON imports fail closed for missing, malformed and invalid assets", async (t) => {
  const root = join(import.meta.dirname, `.prompt-import-${randomUUID()}`);
  await mkdir(root);
  t.after(() => rm(root, { recursive: true, force: true }));
  const loader = await readFile(new URL("../public/prompts/human-loop.js", import.meta.url), "utf8");
  for (const [name, content, error] of [
    ["missing", null, /ERR_MODULE_NOT_FOUND|Cannot find module/],
    ["malformed", '{"schemaVersion":', /JSON|Unexpected/],
    ["invalid", JSON.stringify({ ...baseline.prompts, extra: true }), /Human-loop prompts:/],
    ["valid", JSON.stringify(currentPrompts()), null],
  ]) {
    const folder = join(root, name);
    await mkdir(folder);
    await writeFile(join(folder, "human-loop.mjs"), loader);
    if (content !== null) await writeFile(join(folder, "human-loop.json"), content);
    const load = import(pathToFileURL(join(folder, "human-loop.mjs")).href);
    if (error) await assert.rejects(load, error);
    else assert.deepEqual((await load).humanLoopPrompts, currentPrompts());
  }
});

test("installed browser natively imports the same JSON and rejects broken prompt assets", { skip: !browserAvailable, timeout: 60_000 }, async (t) => {
  const loader = await readFile(new URL("../public/prompts/human-loop.js", import.meta.url), "utf8");
  const json = await readFile(new URL("../public/prompts/human-loop.json", import.meta.url), "utf8");
  const requests = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    requests.push(path);
    if (path === "/") { response.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>Prompt imports</title>"); return; }
    if (path.endsWith(".js")) { response.writeHead(200, { "content-type": "text/javascript" }).end(loader); return; }
    if (path === "/missing/human-loop.json") { response.writeHead(404).end(); return; }
    const content = path === "/malformed/human-loop.json" ? '{"schemaVersion":'
      : path === "/invalid/human-loop.json" ? JSON.stringify({ ...baseline.prompts, roles: {} }) : json;
    response.writeHead(200, { "content-type": path === "/wrong-mime/human-loop.json" ? "text/plain" : "application/json" }).end(content);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const browser = await openFixtureBrowser(t);
  t.diagnostic(`Native JSON import browser: ${(await browser.call("Browser.getVersion")).product}`);
  await browser.call("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` });
  await browser.waitFor("document.title === 'Prompt imports'");
  const imported = await browser.evaluate(`(async () => {
    const { humanLoopPrompts } = await import('/valid/human-loop.js');
    return { value: humanLoopPrompts, frozen: Object.isFrozen(humanLoopPrompts.roles.implementer.task) };
  })()`);
  assert.deepEqual(imported, { value: currentPrompts(), frozen: true });
  for (const name of ["missing", "malformed", "invalid", "wrong-mime"]) {
    const result = await browser.evaluate(`import('/${name}/human-loop.js').then(() => ({ accepted: true }), error => ({ accepted: false, message: error.message }))`);
    assert.equal(result.accepted, false, name);
    assert.ok(result.message, name);
    assert.ok(requests.includes(`/${name}/human-loop.json`), name);
  }
});
