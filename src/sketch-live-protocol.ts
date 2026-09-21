export const sketchLiveFailureMessages = {
    authentication_failed: "GPT-live Azure authentication failed. Check Azure CLI sign-in in the configured tenant.",
    transport_failed: "GPT-live could not connect to the Azure service. Check your network and retry.",
    unauthorized: "The GPT-live service rejected Azure authentication (HTTP 401). Sign in again with Azure CLI.",
    access_denied: "The GPT-live service denied access (HTTP 403). Your Azure identity needs access to the configured deployment.",
    route_unavailable: "The GPT-live service endpoint is unavailable (HTTP 404). Check the configured Live endpoint.",
    throttled: "The GPT-live service is busy or rate-limited (HTTP 429). Wait before retrying.",
    protocol_rejected: "The GPT-live service rejected a protocol message. Reload Tandem before retrying.",
    delegation_required: "GPT-live rejected a context message without its required delegation ID. Reload Tandem to use the corrected voice protocol.",
    startup_timeout: "GPT-live did not acknowledge startup in time. Check your connection and retry.",
    invalid_command: "Tandem rejected an invalid or oversized GPT-live command. Reload Tandem before retrying.",
    provider_failed: "GPT-live ended unexpectedly. Check the current Sketch stage and connection before retrying.",
} as const;

export type SketchLiveFailureCode = keyof typeof sketchLiveFailureMessages;

export function sketchLiveFailureMessage(code: unknown): string | undefined {
    return typeof code === "string" && Object.hasOwn(sketchLiveFailureMessages, code)
        ? sketchLiveFailureMessages[code as SketchLiveFailureCode] : undefined;
}

export function readSketchLiveInitialContext(value: unknown): string[] {
    const kinds = new Set(["sketch-context", "goal", "accepted-requirement", "screen", "shape", "scene-summary", "drawing-work"]);
    if (!Array.isArray(value) || value.length > 32) throw new Error("Invalid initial sketch context.");
    const encoder = new TextEncoder();
    let bytes = 0;
    return value.map((entry: unknown) => {
        if (typeof entry !== "string") throw new Error("Invalid initial sketch context.");
        const size = encoder.encode(entry).length;
        bytes += size;
        if (size > 500 || bytes > 12_000) throw new Error("Initial sketch context exceeds its byte limit.");
        const record: unknown = JSON.parse(entry);
        if (!record || typeof record !== "object" || Array.isArray(record)
            || !("kind" in record) || typeof record.kind !== "string" || !kinds.has(record.kind)) {
            throw new Error("Invalid initial sketch context record.");
        }
        return entry;
    });
}
