import type { SketchDocument } from "./sketch.js";
import { MAX_SKETCH_STREAM_RESPONSE_BYTES, SketchOperationStream } from "./sketch-stream.js";

export interface SketchWorkerEvent {
    type: string;
    agentId?: string;
    data: unknown;
}

interface SketchWorkerOptions {
    runId: string;
    signal: AbortSignal;
    base: SketchDocument | null;
    decisionIds: string[];
    subscribe: (handler: (event: SketchWorkerEvent) => void) => () => void;
    getRunDetail: () => Promise<{
        runId: string;
        agents: readonly { runId: string; toolCallId: string }[];
    }>;
    run: () => Promise<unknown>;
    preview: (document: SketchDocument, sequence: number) => void;
    failed: (error: Error) => void;
}

function record(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

/** The factory result remains authoritative; SDK deltas only drive a disposable preview. */
export async function runSketchStreamWorker(options: SketchWorkerOptions): Promise<SketchDocument> {
    options.signal.throwIfAborted();
    const stream = new SketchOperationStream(options.base, options.decisionIds, options.preview);
    const messages = new Map<string, { text: string; completed: boolean }>();
    let agentId: string | undefined;
    let toolCallId: string | undefined;
    let received = "";
    let failure: Error | undefined;
    let closed = false;
    const pendingWorkers = new Map<string, { agentId?: string; events: SketchWorkerEvent[] }>();
    const lookups = new Set<Promise<void>>();
    let lookupCount = 0;
    let bufferedBytes = 0;
    let bufferedEvents = 0;
    const encoder = new TextEncoder();
    const fail = (cause: unknown) => {
        if (failure) return;
        failure = cause instanceof Error ? cause : new Error("The drawing stream could not be read.");
        options.failed(failure);
    };
    const append = (text: string) => {
        stream.append(text);
        received += text;
    };
    const aborted = () => fail(new Error("Drawing generation was cancelled. The previous saved revision is unchanged."));
    options.signal.addEventListener("abort", aborted, { once: true });
    const bindWorker = (id: string, eventAgentId?: string) => {
        if (toolCallId && toolCallId !== id) {
            throw new Error("More than one worker tried to produce this drawing stream.");
        }
        toolCallId = id;
        agentId = eventAgentId;
    };
    const verifyWorker = (id: string, eventAgentId?: string) => {
        if (pendingWorkers.has(id)) return;
        if (++lookupCount > 32) throw new Error("Too many workers tried to identify this drawing stream.");
        const pending = { agentId: eventAgentId, events: [] as SketchWorkerEvent[] };
        pendingWorkers.set(id, pending);
        const lookup = (async () => {
            try {
                const detail = await options.getRunDetail();
                if (closed || failure || options.signal.aborted) return;
                if (detail.runId !== options.runId) throw new Error("The drawing stream lookup returned a different factory run.");
                if (!detail.agents.some((agent) => agent.runId === options.runId && agent.toolCallId === id)) return;
                bindWorker(id, eventAgentId);
                for (const event of pending.events) receive(event);
            } catch (error) {
                if (!closed) fail(error);
            } finally {
                pendingWorkers.delete(id);
            }
        })();
        lookups.add(lookup);
        void lookup.then(() => lookups.delete(lookup));
    };
    const receive = (event: SketchWorkerEvent) => {
        if (closed || failure || options.signal.aborted || !record(event.data)) return;
        const data = event.data;
        try {
            if (event.type === "subagent.started") {
                if (data.parentId || (data.factoryRunId !== undefined && data.factoryRunId !== options.runId)) return;
                if (typeof data.toolCallId !== "string" || !data.toolCallId) {
                    throw new Error("The drawing worker started without a stream identity.");
                }
                // Older runtimes omit factoryRunId; never infer ownership from arrival order or an agent name.
                if (data.factoryRunId === undefined) verifyWorker(data.toolCallId, event.agentId);
                else bindWorker(data.toolCallId, event.agentId);
                return;
            }
            if (event.type !== "assistant.message_delta" && event.type !== "assistant.message") return;
            if (!(agentId && event.agentId === agentId)
                && !(toolCallId && data.parentToolCallId === toolCallId)) {
                const pending = [...pendingWorkers.entries()].find(([id, worker]) =>
                    (worker.agentId && event.agentId === worker.agentId) || data.parentToolCallId === id)?.[1];
                if (pending) {
                    bufferedBytes += encoder.encode(JSON.stringify(event)).length;
                    if (++bufferedEvents > 16384 || bufferedBytes > 2 * MAX_SKETCH_STREAM_RESPONSE_BYTES) {
                        throw new Error("The unverified drawing stream exceeded its buffer limit.");
                    }
                    pending.events.push(event);
                }
                return;
            }
            if (typeof data.messageId !== "string" || !data.messageId || data.messageId.length > 256) {
                throw new Error("The drawing stream has an invalid message identity.");
            }
            if (Array.isArray(data.toolRequests) && data.toolRequests.length) {
                throw new Error("The drawing worker requested tools instead of drawing operations.");
            }
            let message = messages.get(data.messageId);
            if (!message) {
                if (messages.size >= 32) throw new Error("The drawing worker returned too many messages.");
                message = { text: "", completed: false };
                messages.set(data.messageId, message);
            }
            if (event.type === "assistant.message_delta") {
                if (message.completed || typeof data.deltaContent !== "string") {
                    throw new Error("The drawing worker sent an invalid or late content delta.");
                }
                append(data.deltaContent);
                message.text += data.deltaContent;
            } else {
                if (typeof data.content !== "string" || !data.content.startsWith(message.text)
                    || (message.completed && data.content !== message.text)) {
                    throw new Error("The completed drawing message does not match its streamed content.");
                }
                append(data.content.slice(message.text.length));
                message.text = data.content;
                message.completed = true;
            }
        } catch (error) {
            fail(error);
        }
    };
    let unsubscribe: (() => void) | undefined;
    try {
        unsubscribe = options.subscribe(receive);
        const result = await options.run();
        await Promise.all(lookups);
        options.signal.throwIfAborted();
        if (failure) throw failure;
        if (typeof result !== "string" || !result.trim()) {
            throw new Error("The drawing worker returned no drawing operations.");
        }
        const authoritative = result.trim();
        const streamed = received.trimStart();
        if (authoritative.startsWith(streamed)) append(authoritative.slice(streamed.length));
        else if (authoritative !== streamed.trimEnd()) {
            throw new Error("The final drawing result does not match its streamed preview.");
        }
        return stream.complete();
    } catch (error) {
        fail(error);
        throw error;
    } finally {
        closed = true;
        pendingWorkers.clear();
        options.signal.removeEventListener("abort", aborted);
        unsubscribe?.();
    }
}
