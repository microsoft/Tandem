import { performance } from 'node:perf_hooks';
import { requireCondition } from './validation.ts';

/** One live dispatch; permission intervals overlap as a union, never as summed callbacks. */
export class PrivateTaskBudget {
  readonly #now: () => number;
  readonly #startedAt: number;
  readonly #pending = new Set<symbol>();
  #waitingSince: number | null = null;
  #waitedMs = 0;

  constructor(now: () => number = () => performance.now()) {
    this.#now = now;
    this.#startedAt = now();
  }

  get waiting(): boolean { return this.#pending.size > 0; }

  beginPermission(): () => void {
    const token = Symbol();
    if (!this.waiting) this.#waitingSince = this.#now();
    this.#pending.add(token);
    return () => {
      requireCondition(this.#pending.delete(token), 'Permission wait already settled.');
      if (!this.waiting) {
        this.#waitedMs += this.#now() - this.#waitingSince!;
        this.#waitingSince = null;
      }
    };
  }

  snapshot() {
    const now = this.#now();
    const elapsedMs = now - this.#startedAt;
    const permissionWaitMs = this.#waitedMs + (this.#waitingSince === null ? 0 : now - this.#waitingSince);
    return { elapsedMs, permissionWaitMs, activeMs: elapsedMs - permissionWaitMs, pendingPermissions: this.#pending.size };
  }
}
