import type { SketchDocument } from "./sketch.js";
import { SketchOperationStream } from "./sketch-stream.js";

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
    const receive = (event: SketchWorkerEvent) => {
        if (failure || options.signal.aborted || !record(event.data)) return;
        const data = event.data;
        try {
            if (event.type === "subagent.started") {
                if (data.factoryRunId !== options.runId || data.parentId) return;
                if (typeof data.toolCallId !== "string" || !data.toolCallId) {
                    throw new Error("The drawing worker started without a stream identity.");
                }
                if (toolCallId && toolCallId !== data.toolCallId) {
                    throw new Error("More than one worker tried to produce this drawing stream.");
                }
                toolCallId = data.toolCallId;
                agentId = event.agentId;
                return;
            }
            if (!(agentId && event.agentId === agentId)
                && !(toolCallId && data.parentToolCallId === toolCallId)) return;
            if (event.type !== "assistant.message_delta" && event.type !== "assistant.message") return;
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
        options.signal.removeEventListener("abort", aborted);
        unsubscribe?.();
    }
}
