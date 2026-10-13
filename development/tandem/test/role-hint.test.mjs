import assert from "node:assert/strict";
import test from "node:test";
import { parseRoleMention } from "../public/role-hint.js";
import { parseRequest } from "../runtime-src/domain/human-loop/contracts.ts";
import { humanLoopPrompts } from "../public/prompts/human-loop.js";

const hint = role => ({ schemaVersion: "human-role-hint/v1", role });
const request = (message, extra = {}) => ({ id: "request", message, receivedAt: "2026-10-13T00:00:00Z", answers: null, ...extra });

test("role hints recognize only one exact leading supported mention and preserve original text", () => {
  for (const role of ["designer", "agent"]) for (const separator of [" ", "\t", "\n", "\r\n"]) {
    const message = `@${role}${separator}  Explain this.\nKeep every character.  `;
    assert.deepEqual(parseRoleMention(message), { roleHint: hint(role), error: null });
    const input = request(message, { roleHint: hint(role) });
    assert.deepEqual(parseRequest(input), input);
  }
});

test("ordinary, unsupported, embedded, email and literal mentions have no syntax", () => {
  for (const message of ["Explain this.", "@planner plan it", "@implementer change it", "@reviewer check it",
    "@Designer explain", "@AGENT explain", "@agents explain", "@designer: explain", " @designer explain",
    "\t@agent example", "\n@designer example", "user@designer.example", "@agent@example.com",
    "`@designer explain`", "```\n@agent example\n```", "> @designer quote", '"@agent quoted"',
    "Discuss @designer and @agent.", "\\@agent literal", "@unknown @agent explain"]) {
    assert.deepEqual(parseRoleMention(message), { roleHint: null, error: null }, message);
  }
  assert.deepEqual(parseRoleMention("@agent Explain the literal `@designer` example."),
    { roleHint: hint("agent"), error: null });
});

test("hint-only and consecutive supported mentions are explicit errors, never guessed recipients", () => {
  for (const message of ["@agent", "@designer \n\t", "@agent @designer explain", "@designer @designer repeat", "@agent\n@designer text"]) {
    const parsed = parseRoleMention(message);
    assert.equal(parsed.roleHint, null);
    assert.match(parsed.error, /Add a message|Use only one/);
    assert.throws(() => parseRequest(request(message, { roleHint: hint(message.startsWith("@agent") ? "agent" : "designer") })),
      /Add a message|Use only one/);
  }
});

test("metadata is strictly validated and never retroactively inferred for old clients or ledgers", () => {
  for (const message of ["@agent", "@designer @agent text", "@agent explain", "ordinary"]) {
    const input = request(message);
    assert.deepEqual(parseRequest(JSON.parse(JSON.stringify(input))), input);
    assert.equal(Object.hasOwn(parseRequest(input), "roleHint"), false);
  }
  for (const roleHint of [null, "agent", {}, { role: "agent" }, { ...hint("agent"), schemaVersion: "v2" },
    hint("planner"), { ...hint("agent"), dispatch: true }, hint("designer")]) {
    assert.throws(() => parseRequest(request("@agent Explain", { roleHint })));
  }
  for (const message of ["ordinary", "@planner explain", "`@agent`", "mail@agent.example"]) {
    assert.throws(() => parseRequest(request(message, { roleHint: hint("agent") })), /does not match/);
  }
  assert.throws(() => parseRequest(request("@agent Explain", { roleHint: hint("agent"),
    answers: { schemaVersion: "human-question-answers/v1", answers: [] } })), /Question answers cannot carry/);
});

test("production Router and assigned-role guidance treat metadata as a preference, not authority", () => {
  assert.match(humanLoopPrompts.roles.router.join("\n"), /each current requests item's optional roleHint.*preference only/);
  assert.match(humanLoopPrompts.roles.router.join("\n"), /different role or implementation confirmation/);
  assert.match(humanLoopPrompts.roles.router.join("\n"), /With no roleHint, use normal routing unchanged/);
  assert.match(humanLoopPrompts.shared.join("\n"), /Follow the actual assigned binding.role, not the preference/);
  assert.match(humanLoopPrompts.shared.join("\n"), /never infer hints from old text without metadata/);
});
