import { lstat, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { HostStateFile } from "../runtime-src/domain/host-state-file.ts";
import { getHostStateWal } from "../runtime-src/domain/host-state-wal.ts";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { requireCondition as check } from "../runtime-src/domain/workflow/validation.ts";

const claims = new Map();
const checksum = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const missing = error => error?.code === "ENOENT";

async function retainedLock(path) {
  for (let directory = dirname(path);; directory = dirname(directory)) {
    try {
      const info = await lstat(directory);
      check(info.isDirectory() && !info.isSymbolicLink(), "Native journal directory is aliased or invalid.");
    } catch (error) { if (!missing(error)) throw error; }
    if (dirname(directory) === directory) break;
  }
  let info;
  try { info = await lstat(path); }
  catch (error) { if (missing(error)) return null; throw error; }
  check(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= 2048,
    "Retained native writer lock is aliased or invalid.");
  const text = await readFile(path, "utf8"), value = JSON.parse(text), after = await lstat(path);
  check(info.dev === after.dev && info.ino === after.ino && info.size === after.size,
    "Native writer lock changed during inspection.");
  check(value?.schemaVersion === "workflow-foundation-lock/v1"
    && Object.keys(value).sort().join(",") === "pid,schemaVersion,token"
    && typeof value.token === "string" && /^[a-f0-9-]{36}$/.test(value.token)
    && Number.isSafeInteger(value.pid) && value.pid > 0 && value.pid <= 2147483647,
  "Retained native writer identity is invalid.");
  return { digest: policyHash(text), identity: `${info.dev}:${info.ino}`, token: value.token, pid: value.pid };
}

function requireDead(lock) {
  let absent = false;
  try { process.kill(lock.pid, 0); }
  catch (error) { absent = error?.code === "ESRCH"; }
  check(absent, "Retained native writer is live or its liveness is unverified; recovery is refused.");
}

/** Uses the existing workspace OS/WAL lease; an old per-store lock is never removed or adopted. */
export class HumanLoopNativeWriter {
  #file; #receipt; #lockPath; #owner; #claimed = false; #instanceId = randomUUID();
  constructor(owner, runtimeDirectory) {
    this.#owner = owner;
    const directory = resolve(runtimeDirectory, "native-shells");
    this.#file = new HostStateFile(owner.workspacePath, join(directory, "sessions.json"));
    this.#receipt = new HostStateFile(owner.workspacePath, join(directory, "writer-reconciliation.json"));
    this.#lockPath = join(directory, ".writer-lock");
  }
  read() { return this.#file.read(); }
  async #verify(content, recovery) {
    check(!claims.has(this.#file.path) || claims.get(this.#file.path) === this,
      "Native journal already has a live runtime writer.");
    const retained = await retainedLock(this.#lockPath), raw = await this.#receipt.read();
    const proof = recovery === undefined ? null : recovery;
    if (proof !== null) check(proof && Object.keys(proof).sort().join(",") === "id,nativeEvidenceDigest"
      && typeof proof.id === "string" && proof.id.length > 0 && checksum(proof.nativeEvidenceDigest),
    "Native writer reconciliation requires exact supported recovery evidence.");
    let receipt;
    const writerId = getHostStateWal(this.#owner.workspacePath).writerId;
    check(checksum(writerId), "Native journal needs the retained exclusive workspace WAL writer.");
    if (raw !== undefined) {
      receipt = JSON.parse(raw);
      check(receipt?.schemaVersion === "human-loop-native-writer/v1"
        && Object.keys(receipt).sort().join(",") === "claim,establishedAt,legacyLock,ownerDigest,path,recovery,schemaVersion,sessionId"
        && receipt.ownerDigest === policyHash(this.#owner) && receipt.sessionId === this.#owner.privateSessionId
        && receipt.path === this.#file.path && typeof receipt.establishedAt === "string"
        && Number.isFinite(Date.parse(receipt.establishedAt))
        && equal(receipt.legacyLock, retained)
        && (receipt.recovery === null || receipt.recovery
          && Object.keys(receipt.recovery).sort().join(",") === "id,nativeEvidenceDigest"
          && typeof receipt.recovery.id === "string" && receipt.recovery.id.length > 0
          && checksum(receipt.recovery.nativeEvidenceDigest))
        && receipt.claim && Object.keys(receipt.claim).sort().join(",") === "instanceId,writerId"
        && checksum(receipt.claim.writerId) && typeof receipt.claim.instanceId === "string"
        && /^[a-f0-9-]{36}$/.test(receipt.claim.instanceId),
      "Native writer reconciliation ownership or retained lock changed.");
    }
    if (this.#claimed) check(receipt?.claim.writerId === writerId && receipt.claim.instanceId === this.#instanceId,
      "Native journal writer generation changed; a new supported recovery is required.");
    if (!this.#claimed) {
      check(proof !== null || content === undefined && raw === undefined && retained === null,
        "Saved native journal writer requires explicit supported recovery before accepting work.");
      if (retained) {
        check(content !== undefined, "Retained native lock has no matching owned journal.");
        requireDead(retained);
      }
    }
    if (!this.#claimed) await this.#receipt.write("bind-native-journal-writer", JSON.stringify({
      schemaVersion: "human-loop-native-writer/v1", ownerDigest: policyHash(this.#owner),
      sessionId: this.#owner.privateSessionId, path: this.#file.path, legacyLock: retained,
      recovery: proof, establishedAt: receipt?.establishedAt ?? new Date().toISOString(),
      claim: { writerId, instanceId: this.#instanceId },
    }));
    check(equal(retained, await retainedLock(this.#lockPath)), "Native writer lock was replaced during reconciliation.");
    claims.set(this.#file.path, this); this.#claimed = true;
    return { previousClaim: receipt?.claim ?? null, legacyLockDigest: retained?.digest ?? null,
      claim: { writerId, instanceId: this.#instanceId } };
  }
  async #run(cause, expected, recovery, update) {
    const previouslyClaimed = this.#claimed;
    try {
      return await this.#file.run(cause, async () => {
        const original = await this.#file.read();
        check(original === expected, "Native shell journal changed outside its writer.");
        const authority = await this.#verify(original, recovery);
        const result = await update(authority);
        await this.#verify(original);
        return result;
      });
    } catch (error) {
      if (!previouslyClaimed) this.close();
      throw error;
    }
  }
  prepare(expected, recovery) {
    return this.#run("prepare-native-journal-writer", expected, recovery, authority => authority);
  }
  mutate(expected, content) {
    return this.#run("native-shell-observation", expected, undefined,
      () => this.#file.write("native-shell-observation", content));
  }
  close() {
    if (claims.get(this.#file.path) === this) claims.delete(this.#file.path);
    this.#claimed = false;
  }
}
