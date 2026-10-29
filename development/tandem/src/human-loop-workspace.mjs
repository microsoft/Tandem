import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep, toNamespacedPath } from "node:path";
import { parseHumanLoopOwner } from "../runtime-src/domain/human-loop/model.ts";
import { parseSnapshotRef } from "../runtime-src/domain/human-loop/contracts.ts";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";

const locks = new Map();
const excluded = new Set([".git", ".tandem", ".teleos", ".tandem-migration.lock", "node_modules"]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const missing = (error) => error?.code === "ENOENT";
const check = (condition, message) => {
  if (!condition) throw new Error(`Human loop workspace: ${message}`);
};
const freeze = (value) => {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
// Windows can advance ctime merely when opening a newly written file read-only.
const stamp = (stat) => [stat.dev, stat.ino, stat.size, stat.mode, stat.nlink, stat.mtimeNs,
  ...(process.platform === "win32" ? [] : [stat.ctimeNs])].join(":");
const identity = (stat) => `${stat.dev}:${stat.ino}`;
const regular = (stat) => check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n,
  "file is non-regular or a symlink/hardlink alias.");
const directory = (stat) => check(stat.isDirectory() && !stat.isSymbolicLink(), "directory is invalid or aliased.");

function pathName(value, mutation = false) {
  check(typeof value === "string" && value.length > 0 && value.normalize("NFC") === value,
    "path must be an exact relative project path.");
  const path = value.replaceAll("\\", "/");
  const parts = path.split("/");
  check(parts.every((part) => part && part !== "." && part !== ".."
    && !/[<>:"|?*\u0000-\u001f\u007f]/.test(part) && !/[. ]$/.test(part)
    && !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)
    && !excluded.has(part.toLowerCase())), "protected, noncanonical, or unsafe path.");
  check(!mutation || !["tandem.md", "teleos.md"].includes(path.toLowerCase()), "root TANDEM.md is Host-owned and protected.");
  return path;
}

function exactKeys(value, keys) {
  check(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(","), "invalid snapshot record shape.");
}

function parseRecord(value, ownerDigest) {
  exactKeys(value, ["schemaVersion", "ownerDigest", "head", "files"]);
  check(value.schemaVersion === "human-loop-snapshot/v1" && value.ownerDigest === ownerDigest,
    "snapshot schema or workspace owner differs.");
  check(value.head === null || /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.head), "invalid snapshot HEAD.");
  check(Array.isArray(value.files), "snapshot files are missing.");
  let previous = "";
  const names = new Set();
  for (const file of value.files) {
    exactKeys(file, ["path", "digest", "bytes", "mode", "encoding", "content"]);
    const path = pathName(file.path);
    check(path === file.path && path > previous && !names.has(path.toLowerCase()), "snapshot paths are aliased or unsorted.");
    previous = path;
    names.add(path.toLowerCase());
    check(typeof file.content === "string" && ["utf8", "base64"].includes(file.encoding), "invalid file encoding.");
    const bytes = Buffer.from(file.content, file.encoding);
    check(bytes.toString(file.encoding) === file.content && bytes.length === file.bytes
      && Number.isSafeInteger(file.bytes) && file.bytes >= 0 && sha256(bytes) === file.digest,
    "snapshot file checksum or byte metadata is corrupt.");
    check(Number.isInteger(file.mode) && file.mode >= 0 && file.mode <= 0o777, "invalid snapshot file mode.");
  }
  return freeze(value);
}

async function git(root, args, allowed = [0]) {
  // Observation only; inherited Git overrides must not redirect ownership checks.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
  return new Promise((fulfill, reject) => {
    const child = spawn("git", ["--no-optional-locks", "-C", root, ...args], {
      env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    const output = [], errors = [];
    child.stdout.on("data", (bytes) => output.push(bytes));
    child.stderr.on("data", (bytes) => errors.push(bytes));
    child.once("error", reject);
    child.once("close", (code) => {
      if (!allowed.includes(code)) reject(new Error(`Human loop workspace: Git observation failed: ${Buffer.concat(errors).toString("utf8").trim()}`));
      else fulfill({ code, text: Buffer.concat(output).toString("utf8").trim() });
    });
  });
}

export async function verifyHumanLoopWorkspaceRoot(root) {
  check(resolve(root) === root, "workspace root must use its canonical absolute path.");
  let current = parse(root).root;
  directory(await lstat(current, { bigint: true }));
  for (const part of root.slice(current.length).split(sep).filter(Boolean)) {
    check((await readdir(current)).includes(part), "workspace root has a path alias.");
    current = join(current, part);
    directory(await lstat(current, { bigint: true }));
  }
  check(await realpath(root) === root, "workspace root is aliased.");
  const top = await git(root, ["rev-parse", "--show-toplevel"]);
  check(resolve(top.text) === root, "owner workspace must be the existing Git worktree root. Initialize Git explicitly if intended; Tandem does not initialize or commit it.");
  return lstat(root, { bigint: true });
}

/**
 * One existing workspace, with content-addressed evidence rather than an editable copy.
 * Snapshots retain observed bytes, not an exclusive lease over ordinary project files.
 * Portable Node APIs cannot compare-and-swap against an editor racing the final rename.
 */
export class HumanLoopWorkspace {
  #owner;
  #verifyOwnership;
  #root;
  #rootIdentity;
  #ownerDigest;

  constructor({ owner, verifyOwnership }) {
    check(typeof verifyOwnership === "function", "a trusted verifyOwnership callback is required.");
    this.#owner = freeze(parseHumanLoopOwner(structuredClone(owner)));
    this.#verifyOwnership = verifyOwnership;
    this.#root = this.#owner.workspacePath;
    this.#ownerDigest = policyHash(this.#owner);
  }

  #serial(work) {
    const key = process.platform === "win32" ? this.#root.toLowerCase() : this.#root;
    const result = (locks.get(key) ?? Promise.resolve()).then(work);
    const tail = result.catch(() => {});
    locks.set(key, tail);
    void tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
    return result;
  }

  async #owned() {
    const verification = this.#verifyOwnership(this.#owner);
    check(verification && typeof verification.then === "function", "verifyOwnership must be an async trusted callback.");
    const result = await verification;
    check(result === undefined || result === true, "workspace ownership verification failed.");
  }

  async #validateRoot() {
    const stat = await verifyHumanLoopWorkspaceRoot(this.#root);
    check(!this.#rootIdentity || this.#rootIdentity === identity(stat), "workspace root identity changed.");
    return stat;
  }

  async #guard() {
    check(this.#rootIdentity, "initialize the workspace first.");
    await this.#owned();
    await this.#validateRoot();
    await this.#owned();
  }

  initialize() {
    return this.#serial(async () => {
      await this.#owned();
      const stat = await this.#validateRoot();
      await this.#owned();
      this.#rootIdentity = identity(stat);
    });
  }

  // Verify every existing component, including exact spelling (case and DOS aliases).
  async #resolve(path, allowMissing = false) {
    let current = this.#root;
    const parts = path.split("/");
    for (let i = 0; i < parts.length; i++) {
      directory(await lstat(current, { bigint: true }));
      const names = await readdir(current);
      const part = parts[i];
      check(!names.some((name) => name !== part && name.toLowerCase() === part.toLowerCase()),
        "path spelling aliases an existing entry.");
      const next = join(current, part);
      if (!names.includes(part)) {
        try {
          await lstat(next);
          throw new Error("Human loop workspace: noncanonical path alias.");
        } catch (error) {
          if (!missing(error)) throw error;
        }
        check(allowMissing, `path does not exist: ${path}`);
        return { absolute: join(current, ...parts.slice(i)), stat: null };
      }
      const stat = await lstat(next, { bigint: true });
      check(!stat.isSymbolicLink(), "symlink/junction aliases are prohibited.");
      if (i < parts.length - 1) directory(stat);
      else if (stat.isFile()) regular(stat);
      else directory(stat);
      check(await realpath(next) === next, "canonical path alias is prohibited.");
      current = next;
      if (i === parts.length - 1) return { absolute: current, stat };
    }
    throw new Error("Human loop workspace: missing relative path.");
  }

  async #file(path, allowMissing = false) {
    const target = await this.#resolve(path, allowMissing);
    if (!target.stat) return null;
    regular(target.stat);
    const handle = await open(target.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat({ bigint: true });
      regular(before);
      check(stamp(before) === stamp(target.stat), "file changed while opening.");
      const bytes = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      const retained = await this.#resolve(path);
      check(stamp(before) === stamp(after) && stamp(before) === stamp(retained.stat)
        && BigInt(bytes.length) === before.size, "unstable file read.");
      return { bytes, digest: sha256(bytes), mode: Number(before.mode & 0o777n), stamp: stamp(before) };
    } finally {
      await handle.close();
    }
  }

  async #head() {
    const result = await git(this.#root, ["rev-parse", "--verify", "--quiet", "HEAD"], [0, 1]);
    check(result.code === 1 || /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(result.text), "invalid Git HEAD.");
    return result.code === 1 ? null : result.text;
  }

  async #scan() {
    const head = await this.#head(), files = [], stamps = [];
    const walk = async (path = "") => {
      const absolute = path ? (await this.#resolve(path)).absolute : this.#root;
      const entries = (await readdir(absolute)).filter((name) => !excluded.has(name.toLowerCase())).sort();
      for (const entry of entries) {
        const raw = path ? `${path}/${entry}` : entry;
        const child = pathName(raw);
        check(child === raw, "inventory contains an ambiguous path separator.");
        const target = await this.#resolve(child);
        if (target.stat.isDirectory()) await walk(child);
        else {
          const image = await this.#file(child);
          const text = image.bytes.toString("utf8");
          const encoding = Buffer.from(text, "utf8").equals(image.bytes) ? "utf8" : "base64";
          files.push({ path: child, digest: image.digest, bytes: image.bytes.length, mode: image.mode,
            encoding, content: image.bytes.toString(encoding) });
          stamps.push([child, image.stamp]);
        }
      }
      const retained = (await readdir(absolute)).filter((name) => !excluded.has(name.toLowerCase())).sort();
      check(JSON.stringify(entries) === JSON.stringify(retained), "unstable workspace inventory.");
      if (path) await this.#resolve(path);
    };
    await walk();
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    check(head === await this.#head(), "HEAD changed during capture.");
    return { record: parseRecord({ schemaVersion: "human-loop-snapshot/v1", ownerDigest: this.#ownerDigest,
      head, files }, this.#ownerDigest), stamps };
  }

  async #evidenceDirectory(create) {
    let current = this.#root;
    for (const part of [".tandem", "living-canvas", "human-loop", "evidence"]) {
      directory(await lstat(current, { bigint: true }));
      const names = await readdir(current);
      check(!names.some((name) => name !== part && name.toLowerCase() === part.toLowerCase()), "evidence directory alias.");
      current = join(current, part);
      if (create) {
        await this.#owned();
        try { await mkdir(current); }
        catch (error) { if (error?.code !== "EEXIST") throw error; }
      }
      directory(await lstat(current, { bigint: true }));
      check(await realpath(current) === current, "evidence directory alias.");
    }
    return current;
  }

  async #artifactBytes(path) {
    const before = await lstat(path, { bigint: true });
    regular(before);
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat({ bigint: true });
      regular(opened);
      check(stamp(before) === stamp(opened), "evidence changed while opening.");
      const bytes = await handle.readFile();
      check(stamp(before) === stamp(await handle.stat({ bigint: true }))
        && stamp(before) === stamp(await lstat(path, { bigint: true })), "unstable evidence read.");
      return bytes;
    } finally { await handle.close(); }
  }

  #ref(value) {
    const ref = parseSnapshotRef(value);
    check(ref.id === `snapshot-${ref.digest}`, "snapshot reference identity is invalid.");
    return ref;
  }

  async #readSnapshot(value) {
    const ref = this.#ref(value);
    const directory = await this.#evidenceDirectory(false);
    const bytes = await this.#artifactBytes(join(directory, `${ref.id}.json`));
    const text = bytes.toString("utf8");
    check(Buffer.from(text, "utf8").equals(bytes), "snapshot is not exact UTF-8.");
    const record = parseRecord(JSON.parse(text), this.#ownerDigest);
    check(policyHash(record) === ref.digest, "snapshot integrity check failed.");
    return record;
  }

  async #removeTemporary(path, expectedIdentity) {
    try {
      const stat = await lstat(path, { bigint: true });
      check(identity(stat) === expectedIdentity && stat.isFile() && !stat.isSymbolicLink(), "temporary file identity changed.");
      await unlink(path);
    } catch (error) { if (!missing(error)) throw error; }
  }

  async #save(record) {
    const digest = policyHash(record), ref = { id: `snapshot-${digest}`, digest };
    const directory = await this.#evidenceDirectory(true);
    const target = join(directory, `${ref.id}.json`);
    try {
      await this.#readSnapshot(ref);
      return freeze(ref);
    } catch (error) { if (!missing(error)) throw error; }
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    await this.#owned();
    const handle = await open(temporary, "wx", 0o600);
    const temporaryIdentity = identity(await handle.stat({ bigint: true }));
    try {
      try { await handle.writeFile(JSON.stringify(record), "utf8"); await handle.sync(); }
      finally { await handle.close(); }
      await this.#guard();
      await this.#evidenceDirectory(false);
      check((await this.#artifactBytes(temporary)).equals(Buffer.from(JSON.stringify(record), "utf8")),
        "temporary evidence content changed before publication.");
      // Atomic no-clobber publication, as for immutable HostStateFile blobs.
      try { await link(temporary, target); }
      catch (error) { if (error?.code !== "EEXIST") throw error; }
    } finally { await this.#removeTemporary(temporary, temporaryIdentity); }
    await this.#readSnapshot(ref);
    return freeze(ref);
  }

  async #capture() {
    await this.#guard();
    const observed = await this.#scan();
    return this.#save(observed.record);
  }

  capture() { return this.#serial(() => this.#capture()); }

  readSnapshot(ref) {
    const input = structuredClone(ref);
    return this.#serial(async () => {
      await this.#guard();
      const record = await this.#readSnapshot(input);
      await this.#owned();
      return record;
    });
  }

  verifySnapshot(ref) {
    const input = structuredClone(ref);
    return this.#serial(async () => {
      await this.#guard();
      await this.#readSnapshot(input);
      const current = await this.#capture();
      check(current.id === input.id && current.digest === input.digest, "snapshot conflict: workspace no longer matches the expected baseline.");
      return current;
    });
  }

  changes(beforeRef, afterRef) {
    const before = structuredClone(beforeRef), after = structuredClone(afterRef);
    return this.#serial(async () => {
      await this.#guard();
      const left = await this.#readSnapshot(before), right = await this.#readSnapshot(after);
      const a = new Map(left.files.map((file) => [file.path, file]));
      const b = new Map(right.files.map((file) => [file.path, file]));
      const changes = [];
      for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
        if (a.get(path)?.digest !== b.get(path)?.digest || a.get(path)?.mode !== b.get(path)?.mode) {
          changes.push({ path, beforeDigest: a.get(path)?.digest ?? null, afterDigest: b.get(path)?.digest ?? null });
        }
      }
      await this.#owned();
      return changes;
    });
  }

  list() {
    return this.#serial(async () => {
      await this.#guard();
      const snapshot = await this.#scan();
      await this.#owned();
      return snapshot.record.files.map((file) => file.path);
    });
  }

  inspectNativePath(value, options) {
    return this.inspectNativePaths([value], options).then(paths => paths[0]);
  }

  #protectNativeRecords(absolute, write) {
    const key = value => process.platform === "win32"
      ? toNamespacedPath(resolve(value)).replace(/[. ]+(?=\\|:|$)/g, "").toLowerCase()
      : resolve(value);
    const target = key(absolute);
    const records = [".tandem", ".teleos", ".tandem-migration.lock", ...(write ? ["TANDEM.md", "TELEOS.md"] : [])];
    for (const name of records) {
      const record = key(join(this.#root, name));
      check(target !== record && !target.startsWith(`${record}${sep}`)
        && !(process.platform === "win32" && target.startsWith(`${record}:`)),
      "Tandem-owned record is protected from direct native access.");
    }
  }

  async #nativeTarget(absolute) {
    let ancestor = absolute;
    const suffix = [];
    for (;;) {
      try {
        const canonical = await realpath(ancestor);
        const target = join(canonical, ...suffix);
        let observed;
        try { observed = await stat(target); }
        catch (error) { if (!missing(error)) throw error; observed = null; }
        return { absolute: target, stat: observed };
      } catch (error) {
        if (!missing(error) || dirname(ancestor) === ancestor) throw error;
        suffix.unshift(basename(ancestor));
        ancestor = dirname(ancestor);
      }
    }
  }

  inspectNativePaths(values, { write = false, allowMissing = false, allowDirectory = false } = {}) {
    check(Array.isArray(values), "native paths must be an array.");
    const inputs = values.map(value => {
      check(typeof value === "string" && value.length > 0, "native path is missing.");
      return isAbsolute(value) ? value : `${this.#root}${sep}${value}`;
    });
    return this.#serial(async () => {
      await this.#guard();
      const paths = [];
      for (const absolute of inputs) {
        this.#protectNativeRecords(absolute, write);
        const target = await this.#nativeTarget(absolute);
        this.#protectNativeRecords(target.absolute, write);
        check(allowMissing || target.stat, `native path does not exist: ${absolute}`);
        check(allowDirectory || !target.stat?.isDirectory(), "native operation requires a file.");
        paths.push({ path: relative(this.#root, target.absolute), absolute: target.absolute,
          directory: target.stat?.isDirectory() ?? false, exists: target.stat !== null });
      }
      await this.#guard();
      return paths;
    });
  }

  read(path) {
    const input = pathName(path);
    return this.#serial(async () => {
      await this.#guard();
      const file = await this.#file(input);
      const content = file.bytes.toString("utf8");
      check(Buffer.from(content, "utf8").equals(file.bytes), "binary file cannot be read with the UTF-8 text tool; use snapshot evidence.");
      await this.#owned();
      return { path: input, digest: file.digest, content };
    });
  }

  validateWrites(changes) {
    for (const { path } of changes) pathName(path, true);
  }

  protectedIndexDigest() {
    return this.#serial(async () => {
      await this.#guard();
      return (await this.#file("TANDEM.md", true))?.digest ?? null;
    });
  }

  replace({ path, expectedDigest, content }) {
    const input = pathName(path, true);
    check(expectedDigest === null || typeof expectedDigest === "string" && /^[a-f0-9]{64}$/.test(expectedDigest),
      "expectedDigest must explicitly name SHA-256 or absence.");
    check(typeof content === "string" && Buffer.from(content, "utf8").toString("utf8") === content, "replacement must be exact UTF-8 text.");
    return this.#serial(async () => {
      await this.#guard();
      const before = await this.#file(input, true);
      check((before?.digest ?? null) === expectedDigest, "file digest conflict; original content was preserved.");
      let parent = "";
      for (const part of input.split("/").slice(0, -1)) {
        parent = parent ? `${parent}/${part}` : part;
        const target = await this.#resolve(parent, true);
        if (!target.stat) {
          await this.#owned();
          try { await mkdir(target.absolute); }
          catch (error) { if (error?.code !== "EEXIST") throw error; }
        }
        directory((await this.#resolve(parent)).stat);
      }
      const target = (await this.#resolve(input, true)).absolute;
      const temporary = join(dirname(target), `.human-loop-${randomUUID()}.tmp`);
      await this.#owned();
      const handle = await open(temporary, "wx", 0o600);
      const temporaryIdentity = identity(await handle.stat({ bigint: true }));
      try {
        try {
          await handle.writeFile(content, "utf8");
          await handle.chmod(before?.mode ?? 0o644);
          await handle.sync();
        } finally { await handle.close(); }
        await this.#guard();
        check((await this.#artifactBytes(temporary)).equals(Buffer.from(content, "utf8")),
          "temporary replacement content changed before publication.");
        const current = await this.#file(input, true);
        check((current?.digest ?? null) === expectedDigest, "file digest conflict before replacement; external edits were preserved.");
        const retainedTemporary = await lstat(temporary, { bigint: true });
        regular(retainedTemporary);
        check(identity(retainedTemporary) === temporaryIdentity, "temporary file identity changed.");
        await rename(temporary, target);
      } finally { await this.#removeTemporary(temporary, temporaryIdentity); }
      const result = await this.#file(input);
      check(result.digest === sha256(Buffer.from(content, "utf8")), "file changed immediately after replacement.");
      return { path: input, digest: result.digest };
    });
  }
}
