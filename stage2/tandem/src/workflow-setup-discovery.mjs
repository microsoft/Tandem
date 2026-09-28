import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  enrollmentAbsolutePath, inspectEnrollmentPath, parseRuntimeEnrollmentConfiguration, WorkflowRuntimeEnrollment,
} from "./workflow-runtime-enrollment.mjs";
import { requireIgnoredApplicationState } from "./workflow-runtime-preconditions.mjs";
import { ProjectPolicyStore } from "../runtime-src/domain/workflow/project-policy-store.ts";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";

function requireSetup(condition, message, retryable = true) {
  if (!condition) throw Object.assign(new Error(message), { setupReason: message, setupRetryable: retryable });
}

async function canonical(path, kind, required = true) {
  enrollmentAbsolutePath(path);
  const info = await inspectEnrollmentPath(path, kind);
  requireSetup(!required || info, `The required ${kind} is missing: ${path}`);
  if (info) requireSetup((await realpath(path)).toLowerCase() === path.toLowerCase(),
    "A setup path resolves to another identity; use its actual canonical location.", false);
  return info;
}

function sameFile(left, right) {
  return ["dev", "ino", "size", "mtimeMs", "ctimeMs"].every((key) => left[key] === right[key]);
}

async function fileIdentity(path, { sdk = false } = {}) {
  await canonical(path, "file");
  const handle = await open(path, "r");
  try {
    const before = await handle.stat(), hash = createHash("sha256");
    let source = "";
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      hash.update(chunk);
      // Read the supplied bundle's own declared runtime version, never execute its locator.
      if (sdk && source.length < 2_000_000) source += chunk.toString("utf8");
    }
    const after = await handle.stat(), current = await canonical(path, "file");
    requireSetup(sameFile(before, after) && sameFile(after, current),
      "An installed SDK, CLI or Node file changed while it was being inspected. Inspect setup again.");
    const version = sdk ? source.match(/\b(?:const|var|let)\s+COPILOT_CLI_VERSION\s*=\s*["']([a-zA-Z0-9.+-]{1,64})["']/)?.[1] : undefined;
    return { digest: hash.digest("hex"), version };
  } finally { await handle.close(); }
}

export async function requireSetupSession({ mainSessionId, attachedSession }) {
  requireSetup(typeof mainSessionId === "string" && mainSessionId.length > 0
    && attachedSession?.sessionId === mainSessionId, "Setup requires the exact current attached Session identity.");
  const rpc = attachedSession.rpc;
  requireSetup(typeof rpc?.mode?.get === "function" && typeof rpc?.metadata?.isProcessing === "function"
    && typeof rpc?.metadata?.activity === "function" && typeof rpc?.queue?.pendingItems === "function",
  "The attached Session lacks required public mode, queue or activity observation APIs.");
  requireSetup(await rpc.mode.get() === "interactive",
    "The attached Session must already be Interactive. Change its mode yourself, then inspect setup again.");
  const [processing, activity, queue] = await Promise.all([
    rpc.metadata.isProcessing(), rpc.metadata.activity(), rpc.queue.pendingItems(),
  ]);
  requireSetup(processing?.processing === false && activity?.hasActiveWork === false
    && Array.isArray(queue?.items) && queue.items.length === 0
    && Array.isArray(queue?.steeringMessages) && queue.steeringMessages.length === 0,
  "Setup needs an idle main Session with no active or queued work. Wait for a known quiet boundary.");
}

async function currentFacts({ repositoryRoot, mainSessionId, attachedSession }) {
  const root = enrollmentAbsolutePath(repositoryRoot);
  await canonical(root, "directory");
  await requireSetupSession({ mainSessionId, attachedSession });
  const enrolled = await new WorkflowRuntimeEnrollment({ repositoryRoot: root, mainSessionId }).read();
  requireSetup(enrolled.status === "missing" && enrolled.revision === 0 && enrolled.configuration === null,
    "Existing, retained or invalid runtime/legacy setup evidence must use existing setup/recovery; first-time setup cannot replace it.", false);
  const state = join(root, ".tandem", "living-canvas");
  const policyPath = join(state, "policy", "project-policy.json");
  let policy;
  try {
    await canonical(policyPath, "file", false);
    ({ policy } = await new ProjectPolicyStore(root).load());
  } catch {
    requireSetup(false, "The retained project policy cannot be validated safely; use existing setup/recovery.", false);
  }
  const auditPath = join(state, "living-context.json");
  if (await canonical(auditPath, "file", false)) {
    let audit;
    try { audit = JSON.parse(await readFile(auditPath, "utf8")); }
    catch { requireSetup(false, "The retained Canvas audit cannot be validated; use existing setup/recovery.", false); }
    requireSetup(["living-context/v1", "living-context/v2"].includes(audit?.schemaVersion)
      && Array.isArray(audit.requests) && Array.isArray(audit.outcomes)
      && (audit.activeRuns === undefined || (Array.isArray(audit.activeRuns) && audit.activeRuns.length === 0))
      && audit.requests.every((entry) => entry?.status === "completed"),
    "Retained Canvas work is active, waiting or invalid; finish or reconcile it before first-time setup.", false);
  }
  await requireIgnoredApplicationState({ repositoryRoot: root, targetWorktreePath: root, policy });
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/^(?:GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES)|GIT_CONFIG(?:_|$))/i.test(name)));
  const options = {
    windowsHide: true, timeout: policy.values.time.attemptMaximumMs,
    maxBuffer: policy.values.resources.requestBytes, env,
  };
  const run = async (args) => (await promisify(execFile)("git", [
    "--no-optional-locks", "-C", root, "-c", "core.fsmonitor=false", ...args,
  ], options)).stdout.trim();
  let filters = "";
  try { filters = await run(["config", "--name-only", "--get-regexp", "^filter\\."]); }
  catch (error) { if (error.code !== 1) throw error; }
  const filterNames = [...new Set(filters.split(/\r?\n/).filter(Boolean).map((key) => key.slice(0, key.lastIndexOf("."))))];
  const overrides = filterNames.flatMap((key) => ["-c", `${key}.smudge=`, "-c", `${key}.clean=`,
    "-c", `${key}.process=`, "-c", `${key}.required=false`]);
  let head, top, common;
  try {
    head = await run([...overrides, "rev-parse", "--verify", "HEAD^{commit}"]);
    top = resolve(await run([...overrides, "rev-parse", "--show-toplevel"]));
    common = resolve(root, await run([...overrides, "rev-parse", "--path-format=absolute", "--git-common-dir"]));
  } catch {
    requireSetup(false, "Setup requires a Git working copy with a committed HEAD. Commit the intended baseline yourself first.");
  }
  requireSetup(root.toLowerCase() === top.toLowerCase(), "The project must be the actual Git working-copy root.");
  requireSetup((await run([...overrides, "status", "--porcelain=v1", "--untracked-files=all"])).length === 0,
    "The project must be clean before setup. Commit or preserve your uncommitted changes yourself; setup changes no app files.");
  await canonical(common, "directory");
  return { root, head, policy, repositoryId: `repository:${policyHash({ root, common })}` };
}

async function unownedPaths(configuration) {
  requireSetup(!(await canonical(configuration.owner.worktreePath, "directory", false))
    && !(await canonical(configuration.runtimeDirectory, "directory", false)),
  "A proposed private source or runtime location already exists. Do not adopt or recreate it; use existing setup/recovery.", false);
}

function outsideProject(root, path) {
  const tail = relative(root.toLowerCase(), path.toLowerCase());
  return tail === ".." || tail.startsWith(`..${sep}`) || isAbsolute(tail);
}

async function installedNode(environment, repositoryRoot) {
  const path = Object.entries(environment).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  for (const entry of path.split(delimiter)) {
    const directory = entry.replace(/^"|"$/g, "");
    if (!isAbsolute(directory)) continue;
    const candidate = resolve(directory, process.platform === "win32" ? "node.exe" : "node");
    if (!outsideProject(repositoryRoot, candidate)) continue;
    try { await lstat(candidate); }
    catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") continue;
      throw error;
    }
    if (await canonical(candidate, "file", false)) return candidate;
  }
  requireSetup(false, "Node 24 or newer was not found on PATH. Install Node and reopen Canvas; no runtime was started.");
}

/**
 * Read-only discovery. sdkModulePath is the composition root's import.meta.resolve result.
 * Reuse the actual attached CLI executable or its supported explicit override.
 * Inspect only fixed executable names on PATH; never scan SDK caches or download.
 */
export async function discoverInstalledRuntime({
  repositoryRoot, policy, sdkModulePath,
  cliPath, nodePath, hostExecutable = process.execPath, environment = process.env,
} = {}) {
  requireSetup(typeof sdkModulePath === "string" || sdkModulePath instanceof URL,
    "The host must supply sdkModulePath from its resolved @github/copilot-sdk installation.");
  const sdkPath = sdkModulePath instanceof URL || sdkModulePath.startsWith("file:")
    ? fileURLToPath(sdkModulePath) : sdkModulePath;
  const cli = cliPath ?? environment.COPILOT_CLI_PATH
    ?? (/^copilot(?:\.exe)?$/i.test(basename(hostExecutable)) ? hostExecutable : undefined);
  requireSetup(typeof cli === "string" && cli.length > 0,
    "The attached executable is not an identifiable Copilot CLI. Supply its exact installed path through COPILOT_CLI_PATH; setup will not scan or download a runtime.");
  nodePath ??= /^node(?:\.exe)?$/i.test(basename(hostExecutable))
    ? hostExecutable : await installedNode(environment, repositoryRoot);
  requireSetup(typeof nodePath === "string" && /^node(?:\.exe)?$/i.test(basename(nodePath)),
    "The host must supply the actual Node 24+ executable path; its embedded host executable is not a Node runtime.");
  enrollmentAbsolutePath(nodePath);
  requireSetup(outsideProject(repositoryRoot, nodePath) && outsideProject(repositoryRoot, sdkPath)
    && outsideProject(repositoryRoot, cli), "SDK, CLI and Node must be installed outside the mutable project.");
  if (nodePath === process.execPath) requireSetup(Number(process.versions.node.split(".")[0]) >= 24
    && !process.versions.electron && !process.versions.bun, "Setup needs an actual Node 24+ runtime, not an embedded application runtime.");
  else {
    await canonical(nodePath, "file");
    const { stdout } = await promisify(execFile)(nodePath, ["--version"], {
      windowsHide: true, timeout: policy.values.time.attemptMaximumMs, maxBuffer: policy.values.resources.requestBytes,
    });
    requireSetup(/^v(?:2[4-9]|[3-9]\d|\d{3,})\.\d+\.\d+(?:[-+][\w.-]+)?\s*$/.test(stdout),
      "The explicitly supplied Node executable must be Node 24 or newer.");
  }
  const [sdk, cliFile, node] = await Promise.all([
    fileIdentity(sdkPath, { sdk: true }), fileIdentity(cli), fileIdentity(nodePath),
  ]);
  return {
    sdk: { modulePath: sdkPath, digest: sdk.digest }, cli: { path: cli, digest: cliFile.digest },
    node: { path: nodePath, digest: node.digest },
    buildId: sdk.version ? `copilot-sdk-runtime-${sdk.version}` : `copilot-sdk-${sdk.digest.slice(0, 16)}`,
  };
}

export async function discoverSetupConfiguration({
  repositoryRoot, mainSessionId, attachedSession, sdkModulePath,
  cliPath, nodePath, hostExecutable = process.execPath, environment = process.env,
  managedRoot = join(homedir(), ".copilot", "living-canvas", "managed"),
  previousConfiguration,
} = {}) {
  const facts = await currentFacts({ repositoryRoot, mainSessionId, attachedSession });
  const runtime = await discoverInstalledRuntime({ repositoryRoot: facts.root, policy: facts.policy,
    sdkModulePath, cliPath, nodePath, hostExecutable, environment });
  const previous = previousConfiguration === undefined ? null : parseRuntimeEnrollmentConfiguration(previousConfiguration);
  requireSetup(!previous || (previous.owner.mainSessionId === mainSessionId && previous.owner.targetWorktreePath === facts.root),
    "The prior proposal belongs to another project or attached Session.", false);
  const ownerId = previous?.owner.ownerId ?? randomUUID();
  const privateSessionId = previous?.owner.privateSessionId ?? randomUUID();
  enrollmentAbsolutePath(managedRoot);
  const configuration = {
    schemaVersion: "workflow-runtime-config/v1",
    owner: {
      ownerId, mainSessionId, privateSessionId, repositoryId: facts.repositoryId,
      worktreePath: previous?.owner.worktreePath ?? join(managedRoot, ownerId, "source"),
      targetWorktreePath: facts.root, policy: facts.policy,
    },
    runtimeDirectory: previous?.runtimeDirectory ?? join(managedRoot, ownerId, "runtime"),
    baseCommit: facts.head, ...runtime,
  };
  const parsed = parseRuntimeEnrollmentConfiguration(configuration);
  await unownedPaths(parsed);
  return parsed;
}

// Independently verify discovery output, including injected discovery, before persisting anything.
export async function validateSetupConfiguration({ repositoryRoot, mainSessionId, attachedSession, configuration }) {
  const parsed = parseRuntimeEnrollmentConfiguration(structuredClone(configuration));
  const facts = await currentFacts({ repositoryRoot, mainSessionId, attachedSession });
  requireSetup(parsed.owner.mainSessionId === mainSessionId && parsed.owner.targetWorktreePath === facts.root,
    "The setup configuration belongs to another project or attached Session.", false);
  requireSetup(parsed.baseCommit === facts.head && policyHash(parsed.owner.policy) === policyHash(facts.policy),
    "Git HEAD or project policy changed since setup inspection. Inspect and confirm a new proposal.");
  await unownedPaths(parsed);
  for (const binding of [parsed.sdk, parsed.cli, parsed.node].filter(Boolean)) {
    requireSetup((await fileIdentity(binding.modulePath ?? binding.path)).digest === binding.digest,
      "An installed SDK, CLI or Node file changed since setup inspection. Inspect and confirm a new proposal.");
  }
  await requireSetupSession({ mainSessionId, attachedSession });
  return parsed;
}
