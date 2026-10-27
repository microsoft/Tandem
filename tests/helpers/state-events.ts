import assert from "node:assert/strict";
import type { UiState } from "../../src/renderer/ui-context.js";

export async function eventReader(url: string, signal: AbortSignal) {
    const response = await fetch(new URL("events", url), { signal });
    assert.equal(response.status, 200);
    assert.ok(response.body);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    return async (matches: (value: UiState) => boolean): Promise<UiState> => {
        for (;;) {
            const boundary = buffer.indexOf("\n\n");
            if (boundary >= 0) {
                const frame = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                if (!frame.startsWith("data: ")) continue;
                const value: UiState = JSON.parse(frame.slice(6));
                if (matches(value)) return value;
                continue;
            }
            const result = await reader.read();
            if (result.done) throw new Error("State event stream closed before the expected update.");
            buffer += decoder.decode(result.value, { stream: true });
        }
    };
}
