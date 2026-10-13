import { setTimeout as delay } from "node:timers/promises";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { object, requireCondition, text, unique } from "../runtime-src/domain/workflow/validation.ts";
import { parseHumanTask } from "./human-loop-task.mjs";

export const privateWorkflowEnvironment = "TANDEM_PRIVATE_WORKFLOW_SESSION";
export const reviewWorkflowName = "tandem-review-scopes";
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
    "Workflow requires the exact owned Reviewer context.");
  return { packet, toolCallId, scopes: parseEvidenceScopes(args.scopes) };
}

export function createReviewCollector(getSession) {
  return {
    name: reviewCollectorToolName,
    description: "For the active Tandem Reviewer only: collect read-only evidence using a native workflow. "
      + "Each scope creates a worker; at most three run concurrently. No total-three cap. The parent alone publishes.",
    parameters: scopeSchema,
    skipPermission: false,
    handler: async args => {
      const session = getSession();
      requireCondition(session?.sessionId, "The workflow provider is still registering.");
      const run = await session.workflow.run(reviewWorkflowName, {
        args, notifyOnComplete: false, logPhaseNames: false,
      });
      return { textResultForLlm: JSON.stringify(run), resultType: run.status === "completed" ? "success" : "failure" };
    },
  };
}

export function createReviewWorkflow(defineWorkflow) {
  return defineWorkflow({
    meta: {
      name: reviewWorkflowName,
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

export function privateReviewRegistration(defineWorkflow, getSession, environment = process.env) {
  if (!environment[privateWorkflowEnvironment]) return null;
  requireCondition(environment[privateWorkflowEnvironment] === environment.SESSION_ID,
    "Private workflow provider belongs to another native session.");
  return { workflows: [createReviewWorkflow(defineWorkflow)], tools: [createReviewCollector(getSession)] };
}

export async function stageReviewProvider(session, extensionPath) {
  requireCondition(typeof session.workspacePath === "string" && session.workspacePath.length > 0,
    "Private workflow bootstrap requires the native session workspace.");
  const workspace = resolve(session.workspacePath), source = resolve(extensionPath);
  requireCondition(await realpath(workspace) === workspace && await realpath(source) === source,
    "Private workflow bootstrap paths are aliased.");
  const sourceStat = await lstat(source);
  requireCondition(sourceStat.isFile() && !sourceStat.isSymbolicLink(), "Private workflow entrypoint is not a regular file.");
  let directory = workspace;
  for (const name of ["extensions", "tandem"]) {
    directory = join(directory, name);
    try { await mkdir(directory); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const stat = await lstat(directory);
    requireCondition(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(directory) === directory,
      "Private workflow extension directory is aliased.");
  }
  const path = join(directory, "extension.mjs");
  const content = `import ${JSON.stringify(pathToFileURL(source).href)};\n`;
  try { await writeFile(path, content, { flag: "wx" }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = await lstat(path);
    requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1
      && await readFile(path, "utf8") === content,
    "Private workflow bootstrap found a different retained extension; nothing was overwritten.");
  }
}

export async function awaitWorkflowProvider(session, { timeoutMs = 15000, intervalMs = 100 } = {}) {
  requireCondition(typeof session.rpc?.extensions?.list === "function"
    && typeof session.rpc?.tools?.initializeAndValidate === "function"
    && typeof session.rpc?.tools?.getCurrentMetadata === "function",
    "Installed SDK cannot observe native workflow-provider startup.");
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
  throw new Error(`Tandem workflow provider and collector did not become ready: ${JSON.stringify(extensions)}`);
}
