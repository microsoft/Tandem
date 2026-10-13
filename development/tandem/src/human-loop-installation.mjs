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
import { inspectEmptyCreatedSetup, inspectUnusedStartup, newNativeCreation, parseNativeCreation } from "./human-loop-startup.mjs";
import { verifyHumanLoopWorkspaceRoot } from "./human-loop-workspace.mjs";
import { verifyNativeSessionAbsent } from "./human-loop-recovery.mjs";
import { privateWorkflowEnvironment } from "./native-evidence-workflow.mjs";

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
  #recordVersion = "human-loop-installation/v3";
  #nativeCreation = null;
  #initialFailure = null;
  #setupRecovery = false;
  #recoveryConfirmation = null;
  #creationAuthorization = null;
  #emptyRepairConfirmation = null;
  #repairCloseIds = new Set();

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
    await verifyHumanLoopWorkspaceRoot(this.#root);
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
    const nativeCreation = newNativeCreation(configuration.owner.privateSessionId);
    await this.#file.mutate("human-loop-prepare", (existing) => {
      requireCondition(existing === undefined, "Runtime preparation already exists; do not replace its identity.");
      return { content: JSON.stringify({ schemaVersion: "human-loop-installation/v3", phase: "prepared", configuration,
        reason: null, closeId: null, closeProof: null, reopenId: null, nativeCreation, initialFailure: null }), result: null };
    });
    this.#configuration = configuration; this.#phase = "prepared"; this.#nativeCreation = nativeCreation;
    return configuration;
  }

  async #loadClosed() {
    const wal = getHostStateWal(this.#root), previouslyOwned = Boolean(wal.writerId);
    try {
      const content = await this.#file.read();
      requireCondition(content !== undefined, "Saved state has no new-model clean-close installation record; no legacy run was adopted.");
      const parsed = JSON.parse(content);
      requireCondition(["human-loop-installation/v2", "human-loop-installation/v3"].includes(parsed?.schemaVersion),
        "Only a supported new-model v2/v3 installation can reopen; incompatible old state was not converted.");
      const record = object(parsed, ["schemaVersion", "phase", "configuration", "reason", "closeId", "closeProof", "reopenId",
        ...(parsed.schemaVersion === "human-loop-installation/v3" ? ["nativeCreation", "initialFailure"] : []),
        ...(Object.hasOwn(parsed, "runtimeHistory") ? ["runtimeHistory"] : [])]);
      requireCondition(["prepared", "creating", "ready", "closing", "closed", "reopening", "recovering", "unknown"].includes(record.phase),
      "The saved installation lifecycle is invalid; no previous work was resumed.");
      requireCondition(record.reason === null || typeof record.reason === "string", "The saved startup reason is invalid.");
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
      const nativeCreation = record.schemaVersion === "human-loop-installation/v3"
        ? parseNativeCreation(record.nativeCreation, configuration.owner.privateSessionId) : null;
      requireCondition(!nativeCreation?.authorization || nativeCreation.authorization.ownerDigest === policyHash(configuration.owner)
        && [configuration, ...runtimeHistory].some(value => policyHash(value) === nativeCreation.authorization.configurationDigest),
      "Initial-creation authorization belongs to another owner or runtime configuration.");
      requireCondition(!nativeCreation || !["ready", "closed"].includes(record.phase) || nativeCreation.status === "created",
        "A ready or closed installation must retain confirmed native creation.");
      requireCondition(record.schemaVersion !== "human-loop-installation/v3"
        || record.initialFailure === null || typeof record.initialFailure === "string", "Invalid retained startup failure.");
      this.#recordVersion = record.schemaVersion; this.#nativeCreation = nativeCreation;
      this.#initialFailure = record.initialFailure ?? null;
      if (!this.#initialFailure && record.schemaVersion === "human-loop-installation/v2" && record.phase === "unknown") {
        const history = await wal.history(this.#file.namespace, this.#file.key, 1000);
        this.#initialFailure = history.map(entry => entry.content ? JSON.parse(entry.content) : null)
          .find(entry => entry?.phase === "unknown" && typeof entry.reason === "string")?.reason ?? null;
      }
      this.#runtimeHistory = runtimeHistory;
      this.#configuration = configuration; this.#closeProof = record.phase === "ready" ? null : proof; this.#phase = record.phase;
      this.#reason = record.reason;
      this.#failedStartup = record.phase === "unknown";
      this.#recoverSaved = record.phase !== "prepared";
      return configuration;
    } catch (error) {
      if (!previouslyOwned && wal.writerId) await wal.close();
      throw error;
    }
  }

  async open({ retry = false } = {}) {
    requireCondition(!this.#setupRecovery, "Initial setup inspection or confirmation is in progress.");
    if (this.#runtime && this.#phase === "ready") return this.#runtime;
    if (this.#opening) return this.#opening;
    if (this.#failedStartup && !retry) throw this.#retryRequired();
    requireCondition(["new", "prepared", "closed"].includes(this.#phase) || (retry && this.#phase === "unknown" && this.#failedStartup),
      this.#retryRequired().message);
    this.#opening = this.#open(retry);
    try { return await this.#opening; }
    finally { this.#opening = null; }
  }
  #failureSummary() {
    return [...new Set([this.#initialFailure, this.#reason].filter(Boolean))].join(" Latest startup result: ");
  }
  #retryRequired() {
    return Object.assign(new Error(`${this.#failureSummary() || "Saved startup is incomplete."} `
      + "Runtime startup needs an explicit Retry after a failed attempt; select Retry runtime inside Development. "
      + "Reconcile Design handoff does not authorize startup recovery or send the retained request."), { code: "human-loop-retry-required" });
  }
  async #open(retry, authorization = null) {
    try {
      const emptyRepair = authorization?.repair?.kind === "verified-empty-created";
      let configuration = await this.prepare();
      if (!retry && (this.#phase === "unknown" || this.#recoverSaved && this.#nativeCreation?.status === "not-requested")) {
        throw this.#retryRequired();
      }
      if (retry && this.#phase === "unknown") {
        if (this.#runtime) {
          requireCondition(typeof this.#runtime.releaseFailedStartup === "function",
            "The failed attempt cannot release its owner in place. Restore its supported runtime before explicitly retrying.");
          await this.#runtime.releaseFailedStartup();
          this.#runtime = null;
          this.#recoverSaved = true;
        } else this.#recoverSaved = true;
      }
      await this.#verifyMain();
      const reopening = this.#recoverSaved || this.#phase === "closed";
      if (reopening) {
        configuration = await this.#loadClosed();
        requireCondition(!this.#options.permissionHandler || typeof this.#options.resetPermissions === "function",
          "Reopening requires scoped renewal of the private session's permission broker.");
      }
      if (!reopening && this.#recordVersion === "human-loop-installation/v2" && this.#phase === "prepared") {
        const preparation = await getHostStateWal(this.#root).history(this.#file.namespace, this.#file.key);
        requireCondition(preparation.length > 0 && preparation.every(entry => entry.content
          && JSON.parse(entry.content).phase === "prepared"
          && policyHash(JSON.parse(entry.content).configuration.owner) === policyHash(configuration.owner)),
        "Legacy preparation has an earlier native-start attempt; use separately confirmed unused-setup inspection.");
        await inspectUnusedStartup(configuration);
        await this.#save("prepared", this.#reason, { schemaVersion: "human-loop-installation/v3",
          nativeCreation: newNativeCreation(configuration.owner.privateSessionId), initialFailure: this.#initialFailure });
      }
      const allowInitialCreation = reopening && retry && !emptyRepair && (this.#nativeCreation?.status === "not-requested" || authorization !== null);
      requireCondition(!authorization || (emptyRepair
        ? this.#recordVersion === "human-loop-installation/v3" && this.#nativeCreation?.status === "created"
          && policyHash(this.#nativeCreation) === authorization.repair.previousCreationDigest
        : this.#recordVersion === "human-loop-installation/v2" && this.#nativeCreation === null),
        "Legacy initial-creation authorization cannot replace an issued or confirmed native creation.");
      if (allowInitialCreation) await inspectUnusedStartup(configuration);
      const installed = await (this.#options.discoverRuntime ?? discoverInstalledRuntime)({
        repositoryRoot: this.#root, policy: configuration.owner.policy, sdkModulePath: this.#options.sdkModulePath,
        cliPath: this.#options.cliPath, nodePath: this.#options.nodePath,
        hostExecutable: this.#options.hostExecutable, environment: this.#options.environment,
      });
      const selected = parseHumanLoopConfiguration({ ...configuration,
        sdk: installed.sdk, cli: installed.cli, node: installed.node, buildId: installed.buildId });
      await this.#verifyFiles(selected, true);
      requireCondition(!authorization || policyHash(selected) === authorization.configurationDigest,
        "Installed runtime changed after recovery confirmation. Inspect again before authorizing initialization.");
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
        configuration, client: suppliedClient,
        ...(this.#options.privateExtensionPath ? { workflowBootstrap: {
          extensionSdkPath: dirname(configuration.sdk.modulePath), extensionPath: this.#options.privateExtensionPath,
        } } : {}),
        verifyOwnership: () => this.verifyOwnership(),
        verifyAdmission: () => this.#verifyMain(),
        permissionHandler: this.#options.permissionHandler,
        beforeNativeCreate: () => this.#beginNativeCreation(),
        afterNativeCreate: sessionId => this.#confirmNativeCreation(sessionId),
      });
      this.#runtime = candidate;
      if (reopening) {
        requireCondition(typeof candidate.validateRecovery === "function" && typeof candidate.recover === "function",
          "The runtime does not support retained-history recovery.");
        this.#checkingClosed = true;
        try {
          if (allowInitialCreation) {
            requireCondition(typeof candidate.validateInitialCreation === "function", "Runtime cannot validate unused setup safely.");
            await candidate.validateInitialCreation();
          }
          if (emptyRepair) {
            requireCondition(typeof candidate.validateEmptyCreatedSetup === "function", "Runtime cannot validate empty-created setup.");
            await candidate.validateEmptyCreatedSetup(this.#repairCloseIds);
          }
          await candidate.validateRecovery();
        } finally { this.#checkingClosed = false; }
        const recoveryId = randomUUID();
        const cleanNativeProof = emptyRepair ? null : this.#closeProof?.native ?? null;
        await this.#save("recovering", null, { reopenId: recoveryId,
          ...(!this.#closeProof ? { closeId: null, closeProof: null } : {}) });
        this.#runtime = candidate;
        this.#creationAuthorization = authorization;
        await candidate.recover(recoveryId, cleanNativeProof, allowInitialCreation || emptyRepair,
          emptyRepair ? authorization.id : null);
        await this.#options.resetPermissions?.(configuration.owner.privateSessionId);
      } else {
        this.#runtime = candidate;
        await candidate.open();
      }
      requireCondition(this.#runtime.sessionId === configuration.owner.privateSessionId, "Runtime returned another private owner.");
      requireCondition(this.#recordVersion !== "human-loop-installation/v3" || this.#nativeCreation?.status === "created",
        "Native creation was not durably confirmed by the owned runtime.");
      await this.#save("ready", null, reopening ? { closeId: null, closeProof: null, reopenId: null } : {});
      if (reopening) this.#closeProof = null;
      this.#recoverSaved = false;
      this.#failedStartup = false;
      await this.#options.afterReady?.();
      return this.#runtime;
    } catch (error) {
      if (error.code === "human-loop-retry-required") throw error;
      if (error.code === "human-loop-native-session-missing" && this.#recordVersion === "human-loop-installation/v2") {
        error.message += " This saved setup has no durable native-creation receipt. Ordinary Retry cannot prove it was never created. "
          + "Use Inspect unused setup recovery for a separately confirmed, evidence-checked one-time initialization of the reserved ID.";
      }
      this.#reason = error instanceof Error ? error.message : "Runtime setup failed.";
      this.#initialFailure ??= this.#reason;
      this.#failedStartup = true;
      if (this.#configuration && this.#phase !== "closed") {
        try { await this.#save("unknown", this.#reason,
          { ...(this.#recordVersion === "human-loop-installation/v3" ? { initialFailure: this.#initialFailure } : {}),
            ...(this.#recoverSaved && this.#phase === "ready" && !this.#closeProof
              ? { closeId: null, closeProof: null, reopenId: null } : {}) }); }
        catch { this.#phase = "unknown"; this.#reason += " Durable setup outcome could not be recorded."; }
      }
      throw error;
    } finally { this.#creationAuthorization = null; }
  }
  async #save(phase, reason, updates = {}) {
    await this.#file.mutate(`human-loop-installation:${phase}`, (content) => {
      requireCondition(content !== undefined, "Saved runtime preparation disappeared.");
      const record = JSON.parse(content);
      requireCondition(record.schemaVersion === this.#recordVersion
        && record.phase === this.#phase && policyHash(record.configuration) === policyHash(this.#configuration)
        && policyHash(record.nativeCreation ?? null) === policyHash(this.#nativeCreation),
      "Saved installation identity or lifecycle ownership changed.");
      if (phase === "reopening") requireCondition(record.closeId === this.#closeProof.id
        && policyHash(record.closeProof) === policyHash(this.#closeProof), "The verified clean-close checkpoint changed.");
      return { content: JSON.stringify({ ...record, ...updates, phase, reason }), result: null };
    });
    this.#phase = phase; this.#reason = reason;
    if (updates.schemaVersion) this.#recordVersion = updates.schemaVersion;
    if (updates.nativeCreation) this.#nativeCreation = updates.nativeCreation;
    if (Object.hasOwn(updates, "initialFailure")) this.#initialFailure = updates.initialFailure;
  }
  async #beginNativeCreation() {
    await this.verifyOwnership();
    requireCondition(this.#nativeCreation?.status === "not-requested" || this.#creationAuthorization,
      "The native creation outcome is already issued, confirmed or unverified; it cannot be retried as a new session.");
    if (this.#creationAuthorization?.repair) {
      const authorization = this.#creationAuthorization;
      const history = await getHostStateWal(this.#root).history(this.#file.namespace, this.#file.key);
      requireCondition(history.length > 1 && JSON.parse(history.at(-1).content).phase === "recovering"
        && policyHash(history.slice(0, -1)) === authorization.installationDigest,
      "Installation changed after the empty-setup repair decision.");
      const empty = await inspectEmptyCreatedSetup(this.#configuration, this.#repairCloseIds);
      requireCondition(empty.ledger.digest === authorization.ledgerDigest && empty.inventoryDigest === authorization.inventoryDigest
        && policyHash(await this.#repairAdmissions()) === authorization.repair.admissionDigest,
      "Empty setup or handoff admission changed immediately before native creation.");
    }
    const requestedAt = new Date().toISOString();
    const nativeCreation = parseNativeCreation({ ...newNativeCreation(this.#configuration.owner.privateSessionId),
      status: "requested", requestId: randomUUID(), requestedAt,
      ...(this.#creationAuthorization ? { authorization: { ...this.#creationAuthorization, consumedAt: requestedAt } } : {}),
    }, this.#configuration.owner.privateSessionId);
    await this.#save(this.#phase, this.#reason, { schemaVersion: "human-loop-installation/v3",
      nativeCreation, initialFailure: this.#initialFailure });
    this.#creationAuthorization = null;
  }
  async #confirmNativeCreation(sessionId) {
    requireCondition(sessionId === this.#configuration.owner.privateSessionId,
      "Native creation acknowledgement belongs to another reserved private session identity or request.");
    if (this.#nativeCreation?.status === "created" || this.#recordVersion === "human-loop-installation/v2") return;
    requireCondition(this.#nativeCreation?.status === "requested",
      "Native acknowledgement has no durably issued creation request.");
    await this.#save(this.#phase, this.#reason, { nativeCreation: parseNativeCreation({
      ...this.#nativeCreation, status: "created", createdAt: new Date().toISOString(),
    }, sessionId) });
  }

  async #inspectLegacyInitialCreation() {
    await this.#verifyMain();
    await this.#loadClosed();
    requireCondition(this.#recordVersion === "human-loop-installation/v2" && this.#nativeCreation === null
      && this.#phase === "unknown" && this.#closeProof === null,
    "One-time unused-setup recovery is only for legacy incomplete setup, never a missing created session.");
    const configuration = this.#configuration, ownerDigest = policyHash(configuration.owner);
    const history = await getHostStateWal(this.#root).history(this.#file.namespace, this.#file.key);
    requireCondition(history.length > 0, "Complete installation history is required for unused-setup recovery.");
    let previous = null;
    const closeIds = new Set();
    const requestId = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
    for (const [index, entry] of history.entries()) {
      requireCondition(entry.content !== null, "Installation history contains deleted state; recovery cannot infer an unused identity.");
      const record = JSON.parse(entry.content);
      requireCondition(record.schemaVersion === "human-loop-installation/v2" && record.nativeCreation === undefined
        && ["prepared", "creating", "unknown", "recovering", "closing"].includes(record.phase)
        && (index > 0 || record.phase === "prepared" && entry.cause === "human-loop-prepare")
        && (index === 0 || entry.cause === `human-loop-installation:${record.phase}`)
        && record.closeProof === null
        && policyHash(parseHumanLoopConfiguration(record.configuration).owner) === ownerDigest
        && record.configuration.runtimeDirectory === configuration.runtimeDirectory,
      "Installation history contains prior Ready, confirmed native creation/close, changed ownership or an unverified origin; no replacement is allowed.");
      let valid = false;
      if (record.phase === "prepared") {
        valid = (!previous || ["prepared", "unknown"].includes(previous.phase) && previous.closeId === null && previous.reopenId === null)
          && record.closeId === null && record.reopenId === null;
      } else if (record.phase === "creating") {
        valid = ["prepared", "creating"].includes(previous?.phase) && record.closeId === null && record.reopenId === null;
      } else if (record.phase === "closing") {
        // Old Stop records intent before trying Close on a runtime that never opened.
        valid = requestId(record.closeId) && record.reopenId === previous?.reopenId
          && (previous?.phase === "unknown" && !closeIds.has(record.closeId)
            || previous?.phase === "closing" && record.closeId === previous.closeId);
        closeIds.add(record.closeId);
      } else if (record.phase === "unknown") {
        valid = ["creating", "recovering", "closing", "unknown"].includes(previous?.phase)
          && record.closeId === previous.closeId && record.reopenId === previous.reopenId
          && typeof record.reason === "string" && record.reason.length > 0;
      } else if (record.phase === "recovering") {
        valid = ["creating", "unknown", "closing", "recovering"].includes(previous?.phase)
          && record.closeId === null && requestId(record.reopenId);
      }
      requireCondition(valid, "Legacy startup or unconfirmed close-intent transitions are invalid; no native session was created.");
      previous = record;
    }
    const startup = await inspectUnusedStartup(configuration);
    await verifyHumanLoopWorkspaceRoot(this.#root);
    await this.#verifyFiles(configuration, true);
    const sdk = await (this.#options.loadSdk ?? (path => import(pathToFileURL(path).href)))(configuration.sdk.modulePath);
    requireCondition(typeof sdk.CopilotClient === "function" && typeof sdk.RuntimeConnection?.forStdio === "function",
      "Installed SDK lacks the owned native absence-inspection APIs.");
    const connection = sdk.RuntimeConnection.forStdio({ path: configuration.cli.path });
    requireCondition(connection?.kind === "stdio", "Recovery inspection requires the configured private stdio runtime.");
    const client = new sdk.CopilotClient({ connection, workingDirectory: this.#root });
    let absence, failure;
    try { absence = await verifyNativeSessionAbsent(client, configuration.owner.privateSessionId); }
    catch (error) { failure = error; }
    try {
      const errors = await client.stop();
      requireCondition(Array.isArray(errors) && errors.length === 0, "Native absence-inspection client did not close cleanly.");
    } catch (error) { failure = failure ? new AggregateError([failure, error], `${failure.message} ${error.message}`) : error; }
    if (failure) throw failure;
    await this.#verifyMain();
    const current = await this.#file.read();
    requireCondition(current === history.at(-1).content, "Installation changed during recovery inspection.");
    const refreshed = await inspectUnusedStartup(configuration);
    requireCondition(policyHash(refreshed) === policyHash(startup), "Saved startup state changed during recovery inspection.");
    return {
      ownerDigest, configurationDigest: policyHash(configuration),
      installationDigest: policyHash(history), ledgerDigest: startup.ledger.digest,
      inventoryDigest: startup.inventoryDigest, nativeAbsenceDigest: policyHash(absence),
    };
  }

  async requestInitialCreationRecovery() {
    requireCondition(!this.#opening && !this.#closeWork && !this.#setupRecovery, "Runtime startup, close or recovery inspection is already active.");
    this.#setupRecovery = true; this.#recoveryConfirmation = null;
    try {
      await this.#verifyMain(); await this.#loadClosed();
      requireCondition(this.#recordVersion === "human-loop-installation/v2" && this.#phase === "unknown" && this.#closeProof === null,
        "Only a legacy incomplete startup can be inspected; active or created runtimes are not changed.");
      if (this.#runtime) {
        await this.#runtime.releaseFailedStartup();
        this.#runtime = null;
      }
      const binding = await this.#inspectLegacyInitialCreation();
      const id = randomUUID();
      this.#recoveryConfirmation = { id, binding, expiresAt: Date.now() + 300_000 };
      return {
        confirmationId: id, privateSessionId: this.#configuration.owner.privateSessionId,
        mainSessionId: this.#configuration.owner.mainSessionId, workspacePath: this.#root,
        reason: this.#failureSummary(),
        message: "The verified saved setup never reached Ready and contains no project work. Native lookup reports this exact reserved identity absent, with no history or live owner. "
          + "Legacy records cannot prove whether an old creation call was issued. Explicitly authorize one initialization of this reserved ID, not restoration of a lost session. "
          + "All existing files, handoffs and startup audit remain unchanged. No model request or implementation is started.",
      };
    } finally { this.#setupRecovery = false; }
  }

  async decideInitialCreationRecovery({ confirmationId, approve }) {
    requireCondition(typeof confirmationId === "string" && typeof approve === "boolean", "A fresh explicit unused-setup decision is required.");
    requireCondition(!this.#opening && !this.#closeWork && !this.#setupRecovery, "Runtime startup, close or recovery inspection is already active.");
    await this.#verifyMain();
    if (approve && this.#nativeCreation?.authorization?.id === confirmationId && this.#phase === "ready") {
      return { recovered: true, duplicate: true };
    }
    const confirmation = this.#recoveryConfirmation;
    requireCondition(confirmation?.id === confirmationId, "Unused-setup confirmation is stale or already consumed. Inspect again; no session was created.");
    this.#recoveryConfirmation = null;
    if (!approve) return { recovered: false };
    requireCondition(confirmation.expiresAt >= Date.now(), "Unused-setup confirmation expired. Inspect again; no session was created.");
    this.#setupRecovery = true;
    try {
      const binding = await this.#inspectLegacyInitialCreation();
      requireCondition(policyHash(binding) === policyHash(confirmation.binding),
        "Startup evidence changed since confirmation was shown. Inspect again; no session was created.");
      await this.#open(true, { id: confirmationId, confirmedAt: new Date().toISOString(), ...binding });
      return { recovered: true, duplicate: false };
    } finally { this.#setupRecovery = false; }
  }

  async #repairAdmissions() {
    if (this.#options.inspectRepairAdmissions) return this.#options.inspectRepairAdmissions();
    try { await lstat(join(this.#root, ".tandem", "living-canvas", "handoffs")); }
    catch (error) {
      if (error.code === "ENOENT") return { handoffs: "absent" };
      throw error;
    }
    throw new Error("Retained project handoffs require the owning project host's admission inspection before repair.");
  }

  async #inspectEmptyRepair() {
    await this.#verifyMain(); await this.#loadClosed();
    requireCondition(this.#recordVersion === "human-loop-installation/v3" && this.#phase === "unknown"
      && this.#nativeCreation?.status === "created" && !this.#nativeCreation.authorization,
    "Repair is only for a previously created, never-used setup; issued, repaired or active identities cannot be replaced.");
    const configuration = this.#configuration, ownerDigest = policyHash(configuration.owner);
    const history = await getHostStateWal(this.#root).history(this.#file.namespace, this.#file.key);
    requireCondition(history.length > 0, "Complete installation history is required for repair.");
    const closeIds = new Set();
    let previousPhase = null, requestId = null, reachedReady = false;
    const transitions = {
      prepared: ["prepared"], creating: ["prepared", "creating"],
      ready: ["creating", "ready"], closing: ["ready", "unknown", "closing"],
      closed: ["closing", "closed"], recovering: ["closed", "unknown", "recovering"],
      unknown: ["creating", "ready", "closing", "recovering", "unknown"],
    };
    for (const [index, entry] of history.entries()) {
      requireCondition(entry.content !== null, "Deleted installation history prevents repair.");
      const record = JSON.parse(entry.content);
      requireCondition(record.schemaVersion === "human-loop-installation/v3"
        && policyHash(parseHumanLoopConfiguration(record.configuration).owner) === ownerDigest
        && record.configuration.runtimeDirectory === configuration.runtimeDirectory
        && (index === 0 ? record.phase === "prepared" && entry.cause === "human-loop-prepare"
          : transitions[record.phase]?.includes(previousPhase) && entry.cause === `human-loop-installation:${record.phase}`),
      "Installation transitions, owner or original preparation cannot be verified for empty repair.");
      const creation = parseNativeCreation(record.nativeCreation, configuration.owner.privateSessionId);
      requireCondition(!creation.authorization, "A prior initialization authorization prevents a second empty repair.");
      if (creation.status === "not-requested") requireCondition(requestId === null, "Issued native creation was erased.");
      else {
        requestId ??= creation.requestId;
        requireCondition(creation.requestId === requestId, "More than one native creation attempt is retained.");
        if (creation.status === "created") requireCondition(policyHash(creation) === policyHash(this.#nativeCreation),
          "The original native creation receipt changed.");
      }
      if (record.phase === "ready") {
        requireCondition(creation.status === "created", "Ready lacks confirmed native creation.");
        reachedReady = true;
      }
      if (record.phase === "closing") {
        requireCondition(typeof record.closeId === "string" && /^[a-f0-9-]{36}$/.test(record.closeId), "Empty close intent lacks its recorded identity.");
        closeIds.add(record.closeId);
      }
      if (record.closeProof) {
        const close = parseHumanCleanClose(record.closeProof);
        requireCondition(close.ownerDigest === ownerDigest && close.native.sessionId === configuration.owner.privateSessionId
          && (!close.native.events || close.native.events.length === 0), "Close evidence contains another owner or retained native history.");
        closeIds.add(close.id);
      }
      previousPhase = record.phase;
    }
    requireCondition(reachedReady, "Use the separate initial-creation recovery for setup that never reached Ready.");
    const empty = await inspectEmptyCreatedSetup(configuration, closeIds);
    const admission = await this.#repairAdmissions();
    await verifyHumanLoopWorkspaceRoot(this.#root); await this.#verifyFiles(configuration, true);
    const sdk = await (this.#options.loadSdk ?? (path => import(pathToFileURL(path).href)))(configuration.sdk.modulePath);
    const client = new sdk.CopilotClient({
      connection: sdk.RuntimeConnection.forStdio({ path: configuration.cli.path }), workingDirectory: this.#root,
      env: { ...process.env, [privateWorkflowEnvironment]: configuration.owner.privateSessionId },
    });
    let absence;
    try { absence = await verifyNativeSessionAbsent(client, configuration.owner.privateSessionId); }
    finally {
      const errors = await client.stop();
      requireCondition(Array.isArray(errors) && errors.length === 0, "Repair's native absence inspector did not close cleanly.");
    }
    await this.#verifyMain();
    requireCondition(await this.#file.read() === history.at(-1).content
      && policyHash(await inspectEmptyCreatedSetup(configuration, closeIds)) === policyHash(empty)
      && policyHash(await this.#repairAdmissions()) === policyHash(admission),
    "Repair evidence changed during inspection.");
    this.#repairCloseIds = closeIds;
    return { ownerDigest, configurationDigest: policyHash(configuration), installationDigest: policyHash(history),
      ledgerDigest: empty.ledger.digest, inventoryDigest: empty.inventoryDigest, nativeAbsenceDigest: policyHash(absence),
      repair: { kind: "verified-empty-created", admissionDigest: policyHash(admission),
        previousCreationDigest: policyHash(this.#nativeCreation) } };
  }

  async requestEmptySetupRepair() {
    requireCondition(!this.#opening && !this.#closeWork && !this.#setupRecovery, "Runtime startup, close or inspection is already active.");
    this.#setupRecovery = true; this.#emptyRepairConfirmation = null;
    try {
      return await (this.#options.withEmptyRepairExclusion ?? (action => action()))(async () => {
        const original = await this.#inspectEmptyRepair();
        if (this.#runtime) { await this.#runtime.releaseFailedStartup(); this.#runtime = null; }
        const binding = await this.#inspectEmptyRepair(), id = randomUUID();
        requireCondition(policyHash(binding) === policyHash(original), "Setup changed while releasing its failed inspector.");
        this.#emptyRepairConfirmation = { id, binding, expiresAt: Date.now() + 300_000 };
        return { confirmationId: id, privateSessionId: this.#configuration.owner.privateSessionId,
          mainSessionId: this.#configuration.owner.mainSessionId, workspacePath: this.#root,
          message: "The journal for this verified-empty native session is unavailable. Repair will reinitialize the same reserved Development session ID, not restore nonexistent history. "
            + "Your project, previous setup audit and prepared handoff are preserved. No model request is sent. Continue Design separately after repair.",
          reason: this.#failureSummary(), binding };
      });
    } finally { this.#setupRecovery = false; }
  }

  async decideEmptySetupRepair({ confirmationId, approve }) {
    requireCondition(typeof confirmationId === "string" && typeof approve === "boolean", "An explicit empty-setup repair decision is required.");
    requireCondition(!this.#opening && !this.#closeWork && !this.#setupRecovery, "Runtime startup, close or inspection is already active.");
    await this.#verifyMain();
    if (approve && this.#phase === "ready" && this.#nativeCreation?.authorization?.id === confirmationId
      && this.#nativeCreation.authorization.repair?.kind === "verified-empty-created") return { repaired: true, duplicate: true };
    const confirmation = this.#emptyRepairConfirmation;
    requireCondition(confirmation?.id === confirmationId, "Repair confirmation is stale or consumed. Inspect again.");
    this.#emptyRepairConfirmation = null;
    if (!approve) return { repaired: false };
    requireCondition(confirmation.expiresAt >= Date.now(), "Repair confirmation expired. Inspect again.");
    this.#setupRecovery = true;
    try {
      return await (this.#options.withEmptyRepairExclusion ?? (action => action()))(async () => {
        const binding = await this.#inspectEmptyRepair();
        requireCondition(policyHash(binding) === policyHash(confirmation.binding), "Repair evidence changed since confirmation. Inspect again.");
        await this.#open(true, { id: confirmationId, confirmedAt: new Date().toISOString(), ...binding });
        return { repaired: true, duplicate: false };
      });
    } finally { this.#setupRecovery = false; }
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
    if (!this.#configuration && await this.#file.journalExists() && !await new HumanLoopPreferences(this.#root).isOnlySavedState()) {
      const content = await this.#file.read(), saved = content ? JSON.parse(content) : null;
      const retry = saved?.phase === "unknown" || saved?.nativeCreation?.status === "not-requested" && saved.phase !== "prepared";
      return {
        schemaVersion: "human-loop-installation-view/v1", status: "saved-state", canStart: !retry, canRetry: retry, canReopen: false,
        canInspectInitialRecovery: saved?.schemaVersion === "human-loop-installation/v2" && saved.phase === "unknown" && saved.closeProof === null,
        reason: saved?.reason ?? this.#reason ?? "Retained Conversation and Design will be verified automatically before Ready. Previous work will not be resumed.",
      };
    }
    return { schemaVersion: "human-loop-installation-view/v1", status: this.#phase,
      reason: ["ready", "closed"].includes(this.#phase) ? this.#reason : this.#failureSummary() || null,
      canStart: ["new", "prepared"].includes(this.#phase) && !this.#failedStartup,
      canRetry: this.#failedStartup || this.#recoverSaved && this.#nativeCreation?.status === "not-requested",
      canInspectEmptyRepair: this.#recordVersion === "human-loop-installation/v3" && this.#phase === "unknown"
        && this.#nativeCreation?.status === "created" && !this.#nativeCreation.authorization,
      canInspectInitialRecovery: this.#recordVersion === "human-loop-installation/v2" && this.#phase === "unknown" && this.#closeProof === null,
      canReopen: this.#phase === "closed" && Boolean(this.#configuration) };
  }
  async close() {
    requireCondition(!this.#setupRecovery, "Finish initial setup inspection before closing.");
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
