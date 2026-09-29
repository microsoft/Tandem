import { setTimeout as delay } from "node:timers/promises";
import { object, requireCondition, text, unique } from "../runtime-src/domain/workflow/validation.ts";
import { parseHumanTask } from "./human-loop-task.mjs";

export const privateWorkflowEnvironment = "TANDEM_PRIVATE_WORKFLOW_SESSION";
export const reviewFactoryName = "tandem-review-scopes";
export const reviewCollectorToolName = "tandem_collect_review_scopes";
export const reviewAgentName = "tandem-review-scope";
const scopeSchema = {
  type: "object", required: ["scopes"],
  properties: { scopes: { type: "array", items: {
    type: "object", required: ["id", "prompt"],
    properties: { id: { type: "string" }, prompt: { type: "string" } },
  } } },
};

export function parseEvidenceScopes(value) {
  requireCondition(Array.isArray(value) && value.length > 0 && value.length <= 4096,
    "Evidence requires between one and 4096 independent scopes.");
  const scopes = value.map(value => {
    const scope = object(value, ["id", "prompt"]);
    return { id: text(scope.id), prompt: text(scope.prompt) };
  });
  unique(scopes.map(scope => scope.id));
  return scopes;
}

export async function collectScopedEvidence(ctx, scopes, context, agent) {
  const results = await ctx.parallel(scopes.map(scope => () => ctx.agent(
    `Shared authoritative parent context:\n${JSON.stringify(context)}\nIndependent scope ${scope.id}:\n${scope.prompt}`,
    { agent, label: scope.id },
  )));
  return scopes.map((scope, index) => ({
    id: scope.id,
    evidence: typeof results[index] === "string" && results[index].trim() ? results[index] : null,
  }));
}

function reviewInput(value, sessionId) {
  const args = object(value, ["scopes", "packet", "toolCallId"]);
  const packet = parseHumanTask(args.packet), toolCallId = text(args.toolCallId);
  requireCondition(packet.binding.role === "reviewer" && packet.binding.sessionId === sessionId,
    "Factory requires the exact owned Reviewer context.");
  return { packet, toolCallId, scopes: parseEvidenceScopes(args.scopes) };
}

export function createReviewCollector(getSession) {
  return {
    name: reviewCollectorToolName,
    description: "For the active Tandem Reviewer only: collect read-only evidence using a native factory. "
      + "Each scope creates a worker; at most three run concurrently. No total-three cap. The parent alone publishes.",
    parameters: scopeSchema,
    skipPermission: false,
    handler: async args => {
      const session = getSession();
      requireCondition(session?.sessionId, "The factory provider is still registering.");
      const run = await session.factory.run(reviewFactoryName, {
        args, notifyOnComplete: false, logPhaseNames: false,
      });
      return { textResultForLlm: JSON.stringify(run), resultType: run.status === "completed" ? "success" : "failure" };
    },
  };
}

export function createReviewFactory(defineFactory) {
  return defineFactory({
    meta: {
      name: reviewFactoryName,
      description: "Collect independent read-only Review evidence. The parent alone publishes the consolidated result.",
      phases: [{ title: "Collect scoped evidence" }],
      limits: { maxConcurrentSubagents: 3 },
      argsSchema: scopeSchema,
    },
    run: async ctx => {
      const { packet, toolCallId, scopes } = reviewInput(ctx.args, ctx.session.sessionId);
      ctx.phase("Collect scoped evidence");
      return { binding: packet.binding, toolCallId,
        scopes: await collectScopedEvidence(ctx, scopes, packet, reviewAgentName) };
    },
  });
}

export async function awaitFactoryProvider(session, { timeoutMs = 15000, intervalMs = 100 } = {}) {
  requireCondition(typeof session.rpc?.extensions?.list === "function"
    && typeof session.rpc?.tools?.initializeAndValidate === "function"
    && typeof session.rpc?.tools?.getCurrentMetadata === "function",
    "Installed SDK cannot observe native factory-provider startup.");
  const deadline = Date.now() + timeoutMs;
  let extensions = [];
  do {
    ({ extensions } = await session.rpc.extensions.list());
    if (extensions.some(extension => extension.name === "tandem" && extension.status === "running"
      && Number.isSafeInteger(extension.pid) && extension.pid > 0)) {
      await session.rpc.tools.initializeAndValidate();
      const { tools } = await session.rpc.tools.getCurrentMetadata();
      requireCondition(tools === null || Array.isArray(tools), "Native tool metadata is invalid.");
      if (tools?.some(tool => tool.name === reviewCollectorToolName)) return;
    }
    // Resume acknowledges before startup; even "failed" can precede a fresh launch.
    await delay(intervalMs);
  } while (Date.now() < deadline);
  throw new Error(`Tandem factory provider and collector did not become ready: ${JSON.stringify(extensions)}`);
}
