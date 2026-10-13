import { lstat, readdir } from "node:fs/promises";
import { HostStateFile, hostDirectoryEntries, inHostStateTransaction } from "../runtime-src/domain/host-state-file.ts";
import { isAbsolute, normalize, parse, relative, resolve, sep } from "node:path";
import { FoundationStorage, decodeRecord, encodeRecord, isMissing } from "../runtime-src/domain/workflow/foundation-storage.ts";
import { parsePrivateOwner } from "../runtime-src/domain/workflow/private-execution-contract.ts";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { integer, object, requireCondition, text, unique } from "../runtime-src/domain/workflow/validation.ts";

const filename = "runtime-enrollment.json";
const fixedOwner = ({ policy, ...owner }) => owner;
const digest = (value) => {
  requireCondition(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), "Executable binding needs a SHA-256 digest.");
  return value;
};

export function enrollmentAbsolutePath(value) {
  const path = text(value);
  requireCondition(isAbsolute(path) && resolve(path) === path && normalize(path) === path
    && path !== parse(path).root && !path.includes("\0"), "Enrollment paths must be canonical absolute non-root paths.");
  if (process.platform === "win32") {
    requireCondition(/^[a-z]:\\/i.test(path) && !path.includes("/"), "Enrollment requires explicit local-drive Windows paths.");
    const parts = path.slice(parse(path).root.length).split(sep);
    requireCondition(parts.every((part) => !/[<>:"|?*\x00-\x1f]/.test(part) && !/[. ]$/.test(part)
      && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)), "Enrollment path uses an unsafe Windows alias or component.");
  }
  return path;
}
const absolutePath = enrollmentAbsolutePath;

const contains = (parent, child) => {
  const path = relative(parent.toLowerCase(), child.toLowerCase());
  return !path || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
};
const separate = (left, right) => !contains(left, right) && !contains(right, left);
const identity = (configuration) => ({
  owner: fixedOwner(configuration.owner), runtimeDirectory: configuration.runtimeDirectory,
});

export function parseRuntimeEnrollmentConfiguration(value) {
  const data = object(value, ["schemaVersion", "owner", "runtimeDirectory", "baseCommit", "buildId", "sdk", "cli", "node"]);
  requireCondition(data.schemaVersion === "workflow-runtime-config/v1", "Unsupported runtime configuration schema.");
  const owner = parsePrivateOwner(data.owner);
  absolutePath(data.owner.worktreePath); absolutePath(data.owner.targetWorktreePath);
  const runtimeDirectory = absolutePath(data.runtimeDirectory);
  requireCondition(separate(runtimeDirectory, owner.worktreePath) && separate(runtimeDirectory, owner.targetWorktreePath),
    "Runtime artifacts and source/target worktrees must be separate, non-nested locations.");
  const baseCommit = text(data.baseCommit);
  requireCondition(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baseCommit), "Enrollment needs an immutable full base commit identity.");
  const executable = (value, key) => {
    const input = object(value, [key, "digest"]);
    const path = absolutePath(input[key]);
    requireCondition([owner.worktreePath, owner.targetWorktreePath, runtimeDirectory].every((root) => !contains(root, path)),
      "Declared SDK/CLI/Node files cannot be owned by the mutable runtime workspaces.");
    return { [key]: path, digest: digest(input.digest) };
  };
  return {
    schemaVersion: "workflow-runtime-config/v1", owner, runtimeDirectory, baseCommit, buildId: text(data.buildId),
    sdk: executable(data.sdk, "modulePath"), cli: executable(data.cli, "path"),
    node: data.node === null ? null : executable(data.node, "path"),
  };
}

function request(value) {
  const data = object(value, ["id", "message", "receivedAt"]);
  const receivedAt = text(data.receivedAt);
  requireCondition(/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(receivedAt) && Number.isFinite(Date.parse(receivedAt)),
    "Enrollment request timestamp must include a valid date, time and timezone.");
  return { id: text(data.id), message: text(data.message), receivedAt };
}

export function parseRuntimeEnrollmentRecord(content) {
  const record = object(decodeRecord(content), ["schemaVersion", "repositoryRoot", "mainSessionId", "revision", "versions"]);
  requireCondition(record.schemaVersion === "workflow-runtime-enrollment/v1", "Unsupported runtime enrollment record.");
  absolutePath(record.repositoryRoot); text(record.mainSessionId); integer(record.revision, 1);
  requireCondition(Array.isArray(record.versions) && record.versions.length === record.revision,
    "Enrollment revision history is incomplete.");
  const versions = record.versions.map((value, index) => {
    const version = object(value, ["revision", "expectedRevision", "request", "configuration", "configurationDigest"]);
    requireCondition(version.revision === index + 1 && version.expectedRevision === index,
      "Enrollment revision ordering is invalid.");
    const configuration = parseRuntimeEnrollmentConfiguration(version.configuration);
    requireCondition(configuration.owner.mainSessionId === record.mainSessionId && policyHash(configuration) === version.configurationDigest,
      "Enrollment configuration owner or digest is corrupt.");
    return { ...version, request: request(version.request), configuration };
  });
  unique(versions.map(({ request }) => request.id));
  requireCondition(versions.every(({ configuration }) => policyHash(identity(configuration)) === policyHash(identity(versions[0].configuration))),
    "Enrollment history cannot replace the original owner or workspace locations.");
  return { ...record, versions };
}
const parseRecord = parseRuntimeEnrollmentRecord;

export async function inspectEnrollmentPath(path, kind) {
  const root = parse(path).root;
  let current = root;
  const parts = path.slice(root.length).split(sep);
  for (const [index, part] of parts.entries()) {
    current = resolve(current, part);
    let info;
    try { info = await lstat(current); }
    catch (error) { if (isMissing(error)) return null; throw error; }
    requireCondition(!info.isSymbolicLink(), "Enrollment path contains a symbolic link or junction.");
    if (index < parts.length - 1 || kind === "directory") {
      requireCondition(info.isDirectory(), "Enrollment directory path contains a non-directory component.");
    } else requireCondition(info.isFile() && info.nlink === 1, "Enrollment file must be a regular file without hardlink aliases.");
    if (index === parts.length - 1) return info;
  }
  return null;
}
const inspectPath = inspectEnrollmentPath;

/**
 * Non-executable configuration only. No SDK imports, provisioning, worktree creation
 * or authority selection; declared binary hashes are not runtime capability proofs.
 */
export class WorkflowRuntimeEnrollment {
  #root;
  #main;
  #base;
  #storage;
  #tail = Promise.resolve();
  #closing = false;
  #publication = null;

  constructor({ repositoryRoot, mainSessionId, boundary } = {}) {
    this.#root = absolutePath(repositoryRoot);
    this.#main = text(mainSessionId);
    this.#base = resolve(this.#root, ".tandem", "living-canvas");
    this.#storage = new FoundationStorage(resolve(this.#base, "workflow", "runtime"), async (point) => {
      await boundary?.(point);
      if (point.point === "before-rename" && this.#publication) await this.#guard(this.#publication);
    });
  }

  async read() {
    if (!inHostStateTransaction(this.#root)) await this.#tail;
    let record = null;
    try {
      record = await this.#load();
      await this.#guard(record?.versions.at(-1)?.configuration ?? null);
      return this.#view(record, null);
    } catch (error) {
      return this.#view(record, error instanceof Error && error.message.startsWith("Workflow: ")
        ? error.message : "Runtime enrollment evidence cannot be read safely; explicit reconciliation is required.");
    }
  }

  ownsWriter(writerId) {
    return typeof writerId === "string" && writerId === this.#storage.writerId;
  }

  save(value) {
    requireCondition(!this.#closing, "Enrollment is closing; command admission is sealed.");
    const data = object(structuredClone(value), ["request", "expectedRevision", "configuration"]);
    const input = {
      request: request(data.request), expectedRevision: integer(data.expectedRevision),
      configuration: parseRuntimeEnrollmentConfiguration(data.configuration),
    };
    requireCondition(input.configuration.owner.mainSessionId === this.#main, "Enrollment request belongs to another main session.");
    const work = this.#tail.then(() => this.#save(input));
    this.#tail = work.then(() => undefined, () => undefined);
    return work;
  }

  async #save(input) {
    let record = await this.#load();
    const configurationDigest = policyHash(input.configuration);
    const retry = record?.versions.find(({ request }) => request.id === input.request.id);
    if (retry) {
      requireCondition(policyHash(retry.request) === policyHash(input.request)
        && retry.expectedRevision === input.expectedRevision && retry.configurationDigest === configurationDigest,
      "Enrollment request ID has conflicting original content, revision or configuration.");
      let reason = null;
      try { await this.#guard(record.versions.at(-1).configuration); }
      catch { reason = "Saved configuration is retained but provisioning/ownership evidence prevents further configuration changes."; }
      return { view: this.#view(record, reason), receipt: this.#receipt(retry), duplicate: true };
    }
    requireCondition(input.expectedRevision === (record?.revision ?? 0), "Enrollment revision is stale.");
    if (record) requireCondition(policyHash(identity(record.versions[0].configuration)) === policyHash(identity(input.configuration)),
      "Enrollment cannot replace the fixed original owner or workspace locations.");
    await this.#guard(input.configuration);
    if (!this.#storage.writerId) await this.#storage.acquireWriter();
    // Another legitimate writer may have published between observational load and acquisition.
    const original = await this.#load();
    requireCondition(policyHash(original) === policyHash(record), "Enrollment changed before writer ownership was acquired.");
    await this.#guard(input.configuration);
    const version = {
      revision: input.expectedRevision + 1, expectedRevision: input.expectedRevision,
      request: input.request, configuration: input.configuration, configurationDigest,
    };
    this.#publication = input.configuration;
    try {
      record = await this.#storage.mutate(filename, "save-runtime-enrollment", (content) => {
        const current = content === undefined ? null : parseRecord(content);
        requireCondition(policyHash(current) === policyHash(original), "Enrollment changed outside its admitted writer.");
        const next = {
          schemaVersion: "workflow-runtime-enrollment/v1", repositoryRoot: this.#root, mainSessionId: this.#main,
          revision: version.revision, versions: [...(current?.versions ?? []), version],
        };
        const serialized = encodeRecord(next);
        return { content: serialized, result: parseRecord(serialized) };
      });
    } finally { this.#publication = null; }
    return { view: this.#view(record, null), receipt: this.#receipt(version), duplicate: false };
  }

  async #load() {
    await inspectPath(this.#storage.directory, "directory");
    await inspectPath(resolve(this.#storage.directory, filename), "file");
    const content = await this.#storage.read(filename);
    if (content === undefined) return null;
    const record = parseRecord(content);
    requireCondition(record.repositoryRoot === this.#root && record.mainSessionId === this.#main,
      "Saved enrollment belongs to another project or main-session owner.");
    return record;
  }

  async #guard(configuration) {
    requireCondition(await inspectPath(this.#root, "directory"), "Enrollment project directory does not exist.");
    await inspectPath(this.#storage.directory, "directory");
    await inspectPath(resolve(this.#storage.directory, filename), "file");
    const entries = await this.#entries(this.#storage.directory);
    const temporary = this.#publication ? entries.filter((name) =>
      /^runtime-enrollment\.json\.[a-f0-9-]{36}\.tmp$/.test(name)) : [];
    requireCondition(temporary.length <= 1, "Unknown concurrent enrollment staging files prevent publication.");
    requireCondition(entries.every((name) => name === filename || (name === ".writer-lock" && this.#storage.writerId)
      || temporary.includes(name)),
    "Runtime enrollment contains orphan writer, provisioning or unknown evidence; no configuration replacement is allowed.");
    for (const name of ["active-operation.json", "implementation-review.json", "implementation-run.json"]) {
      requireCondition(!(await this.#exists(resolve(this.#base, name))), "Retained legacy execution evidence blocks runtime configuration changes.");
    }
    const workflow = resolve(this.#base, "workflow");
    requireCondition((await this.#entries(workflow)).every((name) => name === "runtime"),
      "Authority, controller or other workflow evidence blocks configuration changes.");
    if (!configuration) return;
    const { owner, runtimeDirectory } = configuration;
    requireCondition(owner.mainSessionId === this.#main, "Configuration main-session owner is not current.");
    requireCondition(separate(this.#root, owner.worktreePath) && separate(this.#root, runtimeDirectory),
      "Private source and runtime artifacts must be outside the project application-state workspace.");
    requireCondition(await inspectPath(owner.targetWorktreePath, "directory"), "The fixed target workspace must already exist.");
    requireCondition(!(await inspectPath(owner.worktreePath, "directory")),
      "The private source path already exists; provisioned or unowned work must be reconciled, not re-enrolled.");
    requireCondition(!(await inspectPath(runtimeDirectory, "directory")) || (await this.#entries(runtimeDirectory)).length === 0,
      "Runtime artifact/private execution evidence exists; saved configuration cannot replace provisioning.");
    for (const path of [configuration.sdk.modulePath, configuration.cli.path, configuration.node?.path].filter(Boolean)) {
      requireCondition(!contains(this.#root, path), "Executable bindings cannot point inside the mutable project workspace.");
      await inspectPath(path, "file");
    }
  }

  async #exists(path) {
    if (path.endsWith(".json")) return await new HostStateFile(this.#root, path).read() !== undefined;
    try { await lstat(path); return true; }
    catch (error) { if (isMissing(error)) return false; throw error; }
  }

  async #entries(path) {
    await inspectPath(path, "directory");
    try { return await hostDirectoryEntries(this.#root, path); }
    catch (error) { if (isMissing(error)) return []; throw error; }
  }

  #receipt(version) {
    return { requestId: version.request.id, revision: version.revision, configurationDigest: version.configurationDigest };
  }

  #view(record, reason) {
    return {
      schemaVersion: "workflow-runtime-enrollment-view/v1", status: reason ? "blocked" : record ? "configured" : "missing",
      revision: record?.revision ?? (reason ? null : 0), configuration: record ? structuredClone(record.versions.at(-1).configuration) : null,
      reason, canSave: !reason, executionEnabled: false,
    };
  }

  close() {
    this.#closing = true;
    return this.#tail.then(() => this.#storage.close());
  }
}
