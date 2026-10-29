import { resolve } from 'node:path';
import { decodeRecord, encodeRecord, FoundationStorage, type StorageBoundary } from './foundation-storage.ts';
import {
  DEFAULT_POLICY, parsePolicySnapshot, policyHash, resolvePolicy, validatePolicyOverrides, type PolicySnapshot,
} from './policy.ts';
import { integer, list, object, requireCondition, text, unique } from './validation.ts';

interface SelectionReceipt {
  requestId: string;
  expectedRevision: number;
  overrideDigest: string;
  selectedDigest: string;
}

interface ProjectPolicyRecord {
  schemaVersion: 'project-policy/v1';
  revision: number;
  currentDigest: string;
  snapshots: PolicySnapshot[];
  receipts: SelectionReceipt[];
}

export interface PolicySelection {
  revision: number;
  policy: PolicySnapshot;
  source: 'documented-defaults' | 'project-record';
}

const fileName = 'project-policy.json';

function decode(content: string): ProjectPolicyRecord {
  const data = object(decodeRecord(content), ['schemaVersion', 'revision', 'currentDigest', 'snapshots', 'receipts']);
  requireCondition(data.schemaVersion === 'project-policy/v1', 'unknown project policy record; inspect without activating.');
  const snapshots = list(data.snapshots, parsePolicySnapshot);
  unique(snapshots.map(({ digest }) => digest));
  const receipts = list(data.receipts, (value) => {
    const receipt = object(value, ['requestId', 'expectedRevision', 'overrideDigest', 'selectedDigest']);
    requireCondition(typeof receipt.overrideDigest === 'string' && /^[0-9a-f]{64}$/.test(receipt.overrideDigest),
      'policy override receipt must contain a SHA-256 digest.');
    return {
      requestId: text(receipt.requestId), expectedRevision: integer(receipt.expectedRevision),
      overrideDigest: text(receipt.overrideDigest), selectedDigest: text(receipt.selectedDigest),
    };
  });
  unique(receipts.map(({ requestId }) => requestId));
  requireCondition(receipts.length > 0 && integer(data.revision) === receipts.length
    && receipts.every((receipt, index) => receipt.expectedRevision === index
      && snapshots.some(({ digest }) => digest === receipt.selectedDigest))
    && data.currentDigest === receipts.at(-1)?.selectedDigest, 'project policy selection history is inconsistent.');
  return {
    schemaVersion: 'project-policy/v1', revision: receipts.length, currentDigest: text(data.currentDigest),
    snapshots, receipts,
  };
}

function selection(record: ProjectPolicyRecord): PolicySelection {
  const policy = record.snapshots.find(({ digest }) => digest === record.currentDigest);
  requireCondition(policy, 'selected policy snapshot is missing.');
  return { revision: record.revision, policy, source: 'project-record' };
}

export function validateProjectPolicyDocument(content: string): unknown { return decode(content); }

// Host-owned application state. There is no agent tool, SDK settings write or automatic activation.
export class ProjectPolicyStore {
  readonly #storage: FoundationStorage;
  readonly #defaults: PolicySnapshot;

  constructor(repositoryRoot: string, options: {
    boundary?: (point: StorageBoundary) => void | Promise<void>;
    defaults?: PolicySnapshot;
  } = {}) {
    this.#defaults = parsePolicySnapshot(options.defaults ?? DEFAULT_POLICY);
    this.#storage = new FoundationStorage(resolve(repositoryRoot, '.tandem', 'living-canvas', 'policy'), options.boundary, this.#defaults);
  }

  acquireWriter(): Promise<void> {
    return this.#storage.acquireWriter();
  }

  close(): Promise<void> {
    return this.#storage.close();
  }

  async load(): Promise<PolicySelection> {
    const content = await this.#storage.read(fileName);
    return content === undefined
      ? { revision: 0, policy: this.#defaults, source: 'documented-defaults' }
      : selection(decode(content));
  }

  async inspect(): Promise<unknown> {
    const content = await this.#storage.read(fileName);
    return content === undefined ? null : decodeRecord(content);
  }

  async select(overrides: unknown, requestId: string, expectedRevision: number) {
    text(requestId);
    integer(expectedRevision);
    validatePolicyOverrides(overrides);
    const admittedOverrides = structuredClone(overrides);
    validatePolicyOverrides(admittedOverrides);
    const overrideDigest = policyHash(admittedOverrides);
    const result = await this.#storage.mutate(fileName, 'select-project-policy', (original) => {
      const record: ProjectPolicyRecord = original === undefined ? {
        schemaVersion: 'project-policy/v1', revision: 0, currentDigest: this.#defaults.digest,
        snapshots: [this.#defaults], receipts: [],
      } : decode(original);
      const previous = record.receipts.find((receipt) => receipt.requestId === requestId);
      if (previous) {
        requireCondition(previous.expectedRevision === expectedRevision && previous.overrideDigest === overrideDigest,
          'policy selection request has conflicting contents.');
        const policy = record.snapshots.find(({ digest }) => digest === previous.selectedDigest);
        requireCondition(policy, 'historical policy snapshot is missing.');
        return {
          content: original!,
          result: { current: selection(record), requestedPolicy: policy, duplicate: true },
        };
      }
      requireCondition(record.revision === expectedRevision, 'project policy selection revision is stale.');
      const requested = resolvePolicy(admittedOverrides, this.#defaults);
      if (!record.snapshots.some(({ digest }) => digest === requested.digest)) record.snapshots.push(requested);
      record.currentDigest = requested.digest;
      record.receipts.push({ requestId, expectedRevision, overrideDigest, selectedDigest: requested.digest });
      record.revision += 1;
      const content = encodeRecord(record);
      return {
        content,
        result: { current: selection(decode(content)), requestedPolicy: requested, duplicate: false },
      };
    });
    return {
      ...result,
      current: { ...result.current, policy: parsePolicySnapshot(result.current.policy) },
      requestedPolicy: parsePolicySnapshot(result.requestedPolicy),
    };
  }
}
