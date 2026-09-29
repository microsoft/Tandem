import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { HostStateFile } from "../runtime-src/domain/host-state-file.ts";
import { getHostStateWal } from "../runtime-src/domain/host-state-wal.ts";
import { ProjectPolicyStore } from "../runtime-src/domain/workflow/project-policy-store.ts";
import { parseHumanLoopOwner } from "../runtime-src/domain/human-loop/model.ts";
import { object, requireCondition, text } from "../runtime-src/domain/workflow/validation.ts";
import { discoverInstalledRuntime } from "./workflow-setup-discovery.mjs";
import { parseHumanCleanClose } from "./human-loop-close.mjs";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { HumanLoopPreferences } from "./human-loop-preferences.mjs";
import { privateWorkflowEnvironment } from "./native-evidence-factory.mjs";

const samePath = (left, right) => process.platform === "win32"
  ? resolve(left).toLowerCase() === resolve(right).toLowerCase() : resolve(left) === resolve(right);
const outside = (root, path) => { const local = relative(root, path); return isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`); };

export function parseHumanLoopConfiguration(value) {
  const data = object(value, ["schemaVersion", "owner", "runtimeDirectory", "sdk", "cli", "node", "buildId"]);
  requireCondition(data.schemaVersion === "human-loop-runtime/v1", "Incompatible two-copy runtime configuration; no conversion was attempted.");
  const owner = parseHumanLoopOwner(data.owner);
  const file = (value, key) => {
    const data = object(value, [key, "digest"]), path = text(data[key]);
    requireCondition(isAbsolute(path) && outside(owner.workspacePath, path) && /^[a-f0-9]{64}$/.test(data.digest),
      "Installed runtime files must be exact hashed paths outside project code.");
    return { [key]: path, digest: data.digest };
  };
  const runtimeDirectory = text(data.runtimeDirectory);
  requireCondition(isAbsolute(runtimeDirectory) && outside(owner.workspacePath, runtimeDirectory),
    "Runtime process data must be outside editable project code.");
  return { schemaVersion: "human-loop-runtime/v1", owner, runtimeDirectory, sdk: file(data.sdk, "modulePath"),
    cli: file(data.cli, "path"), node: file(data.node, "path"), buildId: text(data.buildId) };
}

export class HumanLoopInstallation {
  #root;
  #main;
  #registration;
  #options;
  #configuration = null;
  #runtimeHistory = [];
  #file;
  #runtime = null;
  #phase = "new";
  #reason = null;
  #opening = null;
  #identities = new Map();
  #closeProof = null;
  #closeWork = null;
  #checkingClosed = false;
  #recoverSaved = false;
  #failedStartup = false;
  #initialStartup = false;

  constructor(options) {
    this.#root = resolve(options.workspacePath); this.#main = options.mainSession;
    this.#registration = options.registration; this.#options = options;
    this.#file = new HostStateFile(this.#root, join(this.#root, ".tandem", "living-canvas", "human-loop", "installation.json"));
  }
  get runtime() { return this.#runtime; }
  get configuration() { return this.#configuration; }

  async #verifyMain() {
    const receipt = this.#registration;
    requireCondition(this.#main?.sessionId && receipt?.session === this.#main && receipt.id
      && typeof receipt.toolHook === "function" && typeof receipt.permissionHandler === "function",
    "One-copy ownership requires the exact joined main-session hook/permission receipt.");
    requireCondition(samePath(await realpath(this.#root), this.#root), "Workspace is aliased; use its actual project root.");
  }

  async #verifyFiles(configuration, initial = false) {
    for (const entry of [configuration.sdk, configuration.cli, configuration.node]) {
      const path = entry.modulePath ?? entry.path;
      const info = await lstat(path);
      requireCondition(info.isFile() && !info.isSymbolicLink() && info.nlink === 1
        && samePath(await realpath(path), path), "Installed runtime file is missing or aliased.");
      const identity = [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(":");
      if (initial || this.#identities.get(path) !== identity) {
        requireCondition(createHash("sha256").update(await readFile(path)).digest("hex") === entry.digest, "Installed runtime content changed; no new process was launched.");
        this.#identities.set(path, identity);
      }
    }
  }

  async prepare() {
    if (this.#configuration) return this.#configuration;
    await this.#verifyMain();
    if (await this.#file.journalExists() && !await new HumanLoopPreferences(this.#root).isOnlySavedState()) return this.#loadClosed();
    const legacy = new HostStateFile(this.#root, join(this.#root, ".tandem", "living-canvas", "workflow", "runtime", "runtime-enrollment.json"));
    requireCondition(await legacy.read() === undefined, "Legacy runtime enrollment is incompatible with one-copy setup.");
    const { policy } = await new ProjectPolicyStore(this.#root).load();
    const installed = await (this.#options.discoverRuntime ?? discoverInstalledRuntime)({
      repositoryRoot: this.#root, policy, sdkModulePath: this.#options.sdkModulePath,
      cliPath: this.#options.cliPath, nodePath: this.#options.nodePath,
      hostExecutable: this.#options.hostExecutable, environment: this.#options.environment,
    });
    const id = randomUUID();
    const configuration = parseHumanLoopConfiguration({
      schemaVersion: "human-loop-runtime/v1",
      owner: { schemaVersion: "human-loop-owner/v1", id, mainSessionId: this.#main.sessionId,
        privateSessionId: randomUUID(), workspacePath: this.#root, policy },
      runtimeDirectory: join(this.#options.runtimeRoot ?? join(homedir(), ".copilot", "living-canvas", "human-loop-runtime"), id),
      ...installed,
    });
    await this.#verifyFiles(configuration, true);
    await this.#file.mutate("human-loop-prepare", (existing) => {
      requireCondition(existing === undefined, "Runtime preparation already exists; do not replace its identity.");
      return { content: JSON.stringify({ schemaVersion: "human-loop-installation/v2", phase: "prepared", configuration,
        reason: null, closeId: null, closeProof: null, reopenId: null }), result: null };
    });
    this.#configuration = configuration; this.#phase = "prepared";
    return configuration;
  }

  async #loadClosed() {
    const wal = getHostStateWal(this.#root), previouslyOwned = Boolean(wal.writerId);
    try {
      const content = await this.#file.read();
      requireCondition(content !== undefined, "Saved state has no new-model clean-close installation record; no legacy run was adopted.");
      const parsed = JSON.parse(content);
      requireCondition(parsed?.schemaVersion === "human-loop-installation/v2",
        "Only a positively closed new-model v2 installation can reopen; incompatible old state was not converted.");
      const record = object(parsed, ["schemaVersion", "phase", "configuration", "reason", "closeId", "closeProof", "reopenId",
        ...(Object.hasOwn(parsed, "runtimeHistory") ? ["runtimeHistory"] : [])]);
      requireCondition(record.schemaVersion === "human-loop-installation/v2"
        && ["prepared", "creating", "ready", "closing", "closed", "reopening", "recovering", "unknown"].includes(record.phase),
      "The saved installation lifecycle is invalid; no previous work was resumed.");
      const configuration = parseHumanLoopConfiguration(record.configuration);
      requireCondition(configuration.owner.mainSessionId === this.#main.sessionId && samePath(configuration.owner.workspacePath, this.#root),
        "The closed runtime belongs to another main session or workspace.");
      if (this.#configuration) requireCondition(policyHash(configuration) === policyHash(this.#configuration), "Closed configuration changed.");
      const history = record.runtimeHistory === undefined ? [] : record.runtimeHistory;
      requireCondition(Array.isArray(history), "Installed runtime provenance is invalid.");
      const runtimeHistory = history.map(parseHumanLoopConfiguration);
      requireCondition(runtimeHistory.every(previous => policyHash(previous.owner) === policyHash(configuration.owner)
        && previous.runtimeDirectory === configuration.runtimeDirectory), "Installed runtime provenance belongs to another owner.");
      const proof = record.closeProof === null ? null : parseHumanCleanClose(record.closeProof);
      if (proof) requireCondition(proof.id === record.closeId && proof.ownerDigest === policyHash(configuration.owner)
        && [configuration, ...runtimeHistory].some(value => proof.configurationDigest === policyHash(value)),
      "Clean-close receipt binding is invalid.");
      this.#runtimeHistory = runtimeHistory;
      this.#configuration = configuration; this.#closeProof = record.phase === "ready" ? null : proof; this.#phase = record.phase;
      this.#recoverSaved = record.phase !== "prepared";
      return configuration;
    } catch (error) {
      if (!previouslyOwned && wal.writerId) await wal.close();
      throw error;
    }
  }

  async open({ retry = false } = {}) {
    if (this.#runtime && this.#phase === "ready") return this.#runtime;
    if (this.#opening) return this.#opening;
    requireCondition(["new", "prepared", "closed"].includes(this.#phase) || (retry && this.#phase === "unknown" && this.#failedStartup),
      "Runtime startup needs an explicit Retry after a failed attempt; active owners are not replaced.");
    this.#opening = this.#open(retry);
    try { return await this.#opening; }
    finally { this.#opening = null; }
  }
  async #open(retry) {
    try {
      if (retry && this.#phase === "unknown") {
        if (this.#runtime) {
          requireCondition(typeof this.#runtime.releaseFailedStartup === "function",
            "The failed attempt cannot release its owner in place. Restore its supported runtime before explicitly retrying.");
          const released = await this.#runtime.releaseFailedStartup();
          this.#initialStartup &&= !released.nativeSessionCreated;
          this.#runtime = null;
          this.#recoverSaved = true;
        } else if (this.#initialStartup && !this.#recoverSaved) {
          await this.#save("prepared", null);
          this.#recoverSaved = false;
        } else this.#recoverSaved = true;
      }
      let configuration = await this.prepare();
      await this.#verifyMain();
      const reopening = this.#recoverSaved || this.#phase === "closed";
      if (!reopening) this.#initialStartup = true;
      if (reopening) {
        configuration = await this.#loadClosed();
        requireCondition(!this.#options.permissionHandler || typeof this.#options.resetPermissions === "function",
          "Reopening requires scoped renewal of the private session's permission broker.");
      }
      const installed = await (this.#options.discoverRuntime ?? discoverInstalledRuntime)({
        repositoryRoot: this.#root, policy: configuration.owner.policy, sdkModulePath: this.#options.sdkModulePath,
        cliPath: this.#options.cliPath, nodePath: this.#options.nodePath,
        hostExecutable: this.#options.hostExecutable, environment: this.#options.environment,
      });
      const selected = parseHumanLoopConfiguration({ ...configuration,
        sdk: installed.sdk, cli: installed.cli, node: installed.node, buildId: installed.buildId });
      await this.#verifyFiles(selected, true);
      const sdk = await (this.#options.loadSdk ?? ((path) => import(pathToFileURL(path).href)))(selected.sdk.modulePath);
      requireCondition(typeof sdk.CopilotClient === "function" && typeof sdk.RuntimeConnection?.forStdio === "function",
        "Installed SDK lacks the public private stdio connection API.");
      if (policyHash(selected) !== policyHash(configuration)) {
        const runtimeHistory = [...this.#runtimeHistory, configuration];
        await this.#save(this.#phase, this.#reason, { configuration: selected, runtimeHistory });
        this.#configuration = configuration = selected;
        this.#runtimeHistory = runtimeHistory;
      }
      if (!reopening) await this.#save("creating", null);
      const connection = sdk.RuntimeConnection.forStdio({ path: configuration.cli.path });
      requireCondition(connection?.kind === "stdio", "Private execution requires an explicit stdio runtime.");
      let client;
      const makeClient = () => client ??= new sdk.CopilotClient({ connection, workingDirectory: this.#root,
        env: { ...process.env, [privateWorkflowEnvironment]: configuration.owner.privateSessionId } });
      const suppliedClient = reopening ? new Proxy({}, { get: (_target, property) => {
        const instance = makeClient(), value = instance[property];
        return typeof value === "function" ? value.bind(instance) : value;
      } }) : makeClient();
      this.#runtime = null;
      const candidate = await this.#options.createRuntime({
        configuration, client: suppliedClient, factoryBootstrap: { extensionSdkPath: dirname(configuration.sdk.modulePath) },
        verifyOwnership: () => this.verifyOwnership(),
        verifyAdmission: () => this.#verifyMain(),
        permissionHandler: this.#options.permissionHandler,
      });
      this.#runtime = candidate;
      if (reopening) {
        requireCondition(typeof candidate.validateRecovery === "function" && typeof candidate.recover === "function",
          "The runtime does not support retained-history recovery.");
        this.#checkingClosed = true;
        try { await candidate.validateRecovery(); } finally { this.#checkingClosed = false; }
        const recoveryId = randomUUID();
        const cleanNativeProof = this.#closeProof?.native ?? null;
        await this.#save("recovering", null, { reopenId: recoveryId,
          ...(!this.#closeProof ? { closeId: null, closeProof: null } : {}) });
        this.#runtime = candidate;
        await candidate.recover(recoveryId, cleanNativeProof, this.#initialStartup);
        await this.#options.resetPermissions?.(configuration.owner.privateSessionId);
      } else {
        this.#runtime = candidate;
        await candidate.open();
      }
      requireCondition(this.#runtime.sessionId === configuration.owner.privateSessionId, "Runtime returned another private owner.");
      await this.#save("ready", null, reopening ? { closeId: null, closeProof: null, reopenId: null } : {});
      if (reopening) this.#closeProof = null;
      this.#recoverSaved = false;
      this.#failedStartup = false;
      this.#initialStartup = false;
      await this.#options.afterReady?.();
      return this.#runtime;
    } catch (error) {
      this.#reason = error instanceof Error ? error.message : "Runtime setup failed.";
      this.#failedStartup = true;
      if (this.#configuration && !["prepared", "closed"].includes(this.#phase)) {
        try { await this.#save("unknown", this.#reason,
          this.#recoverSaved && this.#phase === "ready" && !this.#closeProof
            ? { closeId: null, closeProof: null, reopenId: null } : {}); }
        catch { this.#phase = "unknown"; this.#reason += " Durable setup outcome could not be recorded."; }
      }
      throw error;
    }
  }
  async #save(phase, reason, updates = {}) {
    await this.#file.mutate(`human-loop-installation:${phase}`, (content) => {
      requireCondition(content !== undefined, "Saved runtime preparation disappeared.");
      const record = JSON.parse(content);
      requireCondition(record.schemaVersion === "human-loop-installation/v2"
        && record.phase === this.#phase && policyHash(record.configuration) === policyHash(this.#configuration),
      "Saved installation identity or lifecycle ownership changed.");
      if (phase === "reopening") requireCondition(record.closeId === this.#closeProof.id
        && policyHash(record.closeProof) === policyHash(this.#closeProof), "The verified clean-close checkpoint changed.");
      return { content: JSON.stringify({ ...record, ...updates, phase, reason }), result: null };
    });
    this.#phase = phase; this.#reason = reason;
  }
  async verifyOwnership() {
    requireCondition(this.#configuration && (["creating", "ready", "closing", "reopening", "recovering"].includes(this.#phase)
      || this.#checkingClosed), "This runtime has no live one-copy authority.");
    await this.#verifyMain(); await this.#verifyFiles(this.#configuration);
    const { policy } = await new ProjectPolicyStore(this.#root).load();
    requireCondition(policy.digest === this.#configuration.owner.policy.digest, "Current project policy differs from the owned runtime.");
  }
  async guardMainTool() {
    // Main chat is independent; observation records messages without admitting requests.
    return undefined;
  }
  async read() {
    if (!this.#configuration && await this.#file.journalExists() && !await new HumanLoopPreferences(this.#root).isOnlySavedState()) return {
      schemaVersion: "human-loop-installation-view/v1", status: "saved-state", canStart: true, canReopen: false,
      reason: this.#reason ?? "Retained Conversation and Design will be verified automatically before Ready. Previous work will not be resumed.",
    };
    return { schemaVersion: "human-loop-installation-view/v1", status: this.#phase, reason: this.#reason,
      canStart: ["new", "prepared"].includes(this.#phase),
      canRetry: this.#phase === "unknown" && this.#failedStartup,
      canReopen: this.#phase === "closed" && Boolean(this.#configuration) };
  }
  async close() {
    if (this.#closeWork) return this.#closeWork;
    requireCondition(this.#runtime && ["ready", "unknown"].includes(this.#phase), "No owned runtime can close.");
    this.#closeWork = this.#close();
    try { return await this.#closeWork; } finally { this.#closeWork = null; }
  }
  async #close() {
    const closeId = randomUUID();
    const warnings = [];
    try { await this.#save("closing", null, { closeId, closeProof: null }); }
    catch (error) { warnings.push(`Saving Close intent failed: ${error.message}`); }
    let closed = false;
    try {
      const value = await this.#runtime.close(closeId, { releaseStore: false, beforeClose: this.#options.beforeClose });
      closed = true;
      const proof = value === undefined ? null : parseHumanCleanClose(value);
      requireCondition(!proof || (proof.id === closeId && proof.configurationDigest === policyHash(this.#configuration)
        && proof.ownerDigest === policyHash(this.#configuration.owner)), "Runtime close returned a mismatched checkpoint.");
      this.#closeProof = proof;
      try { await this.#options.resetPermissions?.(this.#configuration.owner.privateSessionId); }
      catch (error) { warnings.push(`Clearing closed-session permission prompts failed: ${error.message}`); }
      warnings.push(...(proof?.warnings ?? []));
      await this.#save("closed", warnings.length ? warnings.join(" ") : null, { closeId, closeProof: proof });
      await getHostStateWal(this.#root).close();
      return { status: "closed", warnings };
    } catch (error) {
      error.message = [...warnings, closed ? `Native runtime closed, but local close recording failed: ${error.message}` : error.message].join(" ");
      try { await this.#save(closed ? "closed" : "unknown", error.message, closed ? { closeId, closeProof: this.#closeProof } : {}); }
      catch (recordingError) {
        this.#phase = closed ? "closed" : "unknown"; this.#reason = error.message;
        error.message += ` Recording the close uncertainty also failed: ${recordingError.message}`;
        process.emitWarning(error.message, { code: "HUMAN_LOOP_CLOSE_RECORDING" });
      }
      throw error;
    }
  }
}
