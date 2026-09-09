import { Worker } from "node:worker_threads";
import workerSource from "tandem:speech-worker";
import type { SpeechBrowserOptions, SpeechInteractiveCredential } from "./speech-auth.js";

export function createBrowserSpeechCredential(options: SpeechBrowserOptions): SpeechInteractiveCredential {
    // Azure Identity's interactive flow does not close its loopback listener on abort.
    // A worker owns both that listener and the memory-only MSAL cache so cancellation
    // can release all resources without touching the user's browser process.
    const worker = new Worker(workerSource, {
        eval: true,
        workerData: { ...options, moduleUrl: import.meta.url },
        execArgv: [],
        stdout: true,
        stderr: true,
    });
    worker.stdout.resume();
    worker.stderr.resume();
    let sequence = 0;
    let closed = false;
    const pending = new Map<number, {
        resolve(value: { token: string; expiresOnTimestamp: number }): void;
        reject(error: Error): void;
        cleanup(): void;
    }>();
    let termination: Promise<void> | undefined;
    const dispose = (): Promise<void> => {
        if (termination) return termination;
        closed = true;
        for (const request of pending.values()) {
            request.cleanup();
            request.reject(new Error("Microsoft sign-in was interrupted. Select Sign in with Microsoft to retry."));
        }
        pending.clear();
        termination = worker.terminate().then(() => undefined);
        return termination;
    };
    worker.on("error", () => { void dispose(); });
    worker.on("exit", () => {
        if (!closed) void dispose();
    });
    worker.on("message", (message: {
        id: number; ok: boolean; token?: { token: string; expiresOnTimestamp: number };
    }) => {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        request.cleanup();
        if (!pending.size) worker.unref();
        if (message.ok && message.token) request.resolve(message.token);
        else request.reject(new Error("Microsoft sign-in failed or needs interaction. Select Sign in with Microsoft to retry."));
    });
    worker.unref();
    const request = (
        action: "authenticate" | "getToken",
        scope: string,
        signal: AbortSignal,
    ) => new Promise<{ token: string; expiresOnTimestamp: number }>((resolve, reject) => {
        if (closed || signal.aborted) {
            reject(new Error("Microsoft sign-in was cancelled or expired. Sign in again."));
            return;
        }
        const id = ++sequence;
        const abort = () => { void dispose(); };
        pending.set(id, { resolve, reject, cleanup: () => signal.removeEventListener("abort", abort) });
        signal.addEventListener("abort", abort, { once: true });
        worker.ref();
        worker.postMessage({ id, action, scope });
    });
    return {
        authenticate: (scope, { abortSignal }) => request("authenticate", scope, abortSignal),
        getToken: (scope, { abortSignal }) => request("getToken", scope, abortSignal),
        dispose,
    };
}
