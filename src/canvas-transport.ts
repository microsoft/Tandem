import type { IncomingMessage, ServerResponse } from "node:http";

export function canvasRequestAllowed(request: Pick<IncomingMessage, "headers" | "method" | "url">, serverUrl: string): boolean {
    const origin = new URL(serverUrl);
    if (request.headers.host !== origin.host) return false;
    if (request.headers.origin && request.headers.origin !== origin.origin) return false;
    const path = new URL(request.url || "/", origin).pathname;
    // A host may embed the page cross-origin, but its API is only for that page.
    if (request.headers["sec-fetch-site"] === "cross-site" && !(request.method === "GET" && path === "/")) return false;
    return true;
}

export async function readJsonRequest(
    request: AsyncIterable<string | Uint8Array>,
    maxBytes: number,
): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > maxBytes) throw new Error("Request is too large.");
        chunks.push(buffer);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Request body must be a JSON object.");
    }
    return Object.fromEntries(Object.entries(value));
}

export function sendJsonResponse(response: ServerResponse, statusCode: number, value: unknown): void {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(value));
}
