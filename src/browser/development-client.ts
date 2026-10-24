import { isRecord } from "./contracts.js";
import { redactDiagnostic } from "./diagnostics.js";

export function watchBrowserDevelopment(
    token: string,
    revision: string,
    reload: () => void,
    fetcher: typeof fetch = (input, init) => fetch(input, init),
): () => void {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let lastError = "";
    const poll = async () => {
        try {
            const response = await fetcher("/host/development", {
                headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
            });
            if (!response.ok) throw new Error(`Development reload check failed (${response.status}).`);
            const value: unknown = await response.json();
            if (!isRecord(value) || typeof value.revision !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(value.revision)) {
                throw new Error("The host returned an invalid development revision.");
            }
            if (controller.signal.aborted) return;
            lastError = "";
            if (value.revision !== revision) {
                controller.abort();
                reload();
                return;
            }
        } catch (error) {
            if (controller.signal.aborted) return;
            const message = redactDiagnostic(error instanceof Error ? error.message : String(error));
            if (message !== lastError) console.error("Tandem development reload:", message);
            lastError = message;
        }
        if (!controller.signal.aborted) timer = setTimeout(poll, 1000);
    };
    timer = setTimeout(poll, 1000);
    return () => { clearTimeout(timer); controller.abort(); };
}
