import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { canOpenDevelopment, hasActiveJobs, useUi, type UiState } from "./ui-context.js";

type Entry = { id: string; kind: "user" | "status"; role: string; text: string; timestamp: string };
export function projectDiscovery(state: UiState, busy: boolean) {
    const stage = state.lifecycle.currentStage;
    const writable = state.provider?.canSubmitAnswers !== false && !state.effortReset && !busy;
    const active = hasActiveJobs(state);
    const action = !state.goal.trim() ? "goal" : stage === "requirements" && state.requirements.substage === "usage" ? "usage"
        : stage === "sketch" ? "sketch" : stage === "prototype" ? "prototype" : "none";
    const label = { goal: "Start discovery", usage: "Add requirement usage", sketch: "Revise saved drawings",
        prototype: "Prototype feedback", none: "Discovery (use artifact controls)" }[action];
    const key = JSON.stringify([state.prototypeId, state.generation, action, state.sketch?.current?.id,
        state.prototypeFlow?.displayedCheckpointId, state.lifecycle.completedStages]);
    return { action, key, label, enabled: writable && action !== "none" && !state.lifecycle.completedStages.includes(stage)
        && (action === "prototype" ? state.processing?.action !== "generate-design-spec" : !active),
        help: action === "sketch" ? "Revise the saved drawing revision; unsaved canvas edits are not included."
            : action === "prototype" ? "Queue feedback against the displayed prototype. Applying an update remains explicit."
                : action === "usage" ? "Add a first-person usage to Requirements. Answer existing questions in the Requirements view."
                    : action === "goal" ? "Start optional discovery with this goal. This runs Preparation, not implementation."
                        : "Browse the saved evidence or answer/confirm using its artifact controls. Activate Development explicitly to discuss Design or implementation." };
}
export function discoveryEntries(state: UiState): Entry[] {
    const entries: Entry[] = [];
    const push = (id: string, kind: Entry["kind"], text: string, timestamp = state.updatedAt) => {
        if (text) entries.push({ id: `discovery:${state.generation}:${id}`, kind, role: "Discovery evidence", text: text.slice(0, 20000), timestamp });
    };
    push("goal", "user", state.goal);
    state.requirements.usageItems.forEach((text, index) => push(`usage:${index}`, "user", text));
    state.decisionGraph.nodes.filter(node => node.answer).forEach(node =>
        push(`answer:${node.id}`, "status", `${node.title}\n${node.answer}`));
    for (const request of state.sketch.requests ?? []) {
        push(`drawing-request:${request.requestId}`, request.kind === "revise" ? "user" : "status", request.instruction, request.requestedAt);
    }
    for (const checkpoint of state.prototypeFlow?.checkpoints ?? []) {
        push(`checkpoint:${checkpoint.id}`, "status", `${checkpoint.milestone}: ${checkpoint.status}. ${checkpoint.summary || ""}`,
            checkpoint.completedAt || checkpoint.requestedAt);
    }
    for (const revision of state.prototypeReview?.revisions ?? []) {
        push(`revision:${revision.id}`, "user", revision.suggestion);
    }
    for (const output of state.lifecycle.outputs) push(`saved:${output.path}`, "status", `Saved ${output.stageId}: ${output.path}`, output.completedAt);
    for (const receipt of state.factoryRuns ?? []) if (receipt.recovery) {
        push(`recovery:${receipt.recovery.decisionId}`, "status",
            `Request ${receipt.requestId} explicitly abandoned with uncertain outcome. Saved work retained; nothing replayed.`,
            receipt.recovery.recordedAt);
    }
    return entries.slice(-1000);
}

interface ProjectView {
    url: string | null; channel: string; error: string; active: boolean;
    status: string; detail: string; designRevision: string | null; designChanged: boolean; attention: number;
    activate(retry?: boolean): Promise<void>; command(command: string): void;
    frame: React.RefObject<HTMLIFrameElement | null>; sync(): void;
}
const Context = createContext<ProjectView | null>(null);
export const useProjectView = () => {
    const value = useContext(Context);
    if (!value) throw new Error("Project presentation is unavailable.");
    return value;
};
export function ProjectConversationProvider({ children, designVisible, showDesign }: { children: ReactNode; designVisible: boolean; showDesign(): void }) {
    const { state, post, pending } = useUi();
    const [view, setView] = useState({ url: null as string | null, channel: "", error: "", active: false,
        status: "Not activated", detail: "", designRevision: null as string | null, designChanged: false, attention: 0 });
    const frame = useRef<HTMLIFrameElement>(null);
    const latest = useRef({ state, post, pending, view, designVisible, showDesign }); latest.current = { state, post, pending, view, designVisible, showDesign };
    const opening = useRef(false), submissions = useRef(new Map<string, { key: string; text: string; work: Promise<void> }>());
    function send(value: object) {
        const { url, channel } = latest.current.view;
        if (url) frame.current?.contentWindow?.postMessage({ protocol: "tandem-project/v1", channel, ...value }, new URL(url).origin);
    }
    function sync() {
        const { state, pending, view, designVisible } = latest.current;
        send({ type: "context", entries: discoveryEntries(state), discovery: projectDiscovery(state, pending),
            canActivate: canOpenDevelopment(state), developmentActive: view.active, designVisible });
    }
    async function activate(retry = false) {
        if (opening.current) return;
        if (!canOpenDevelopment(latest.current.state)) { setView(v => ({ ...v, error: "Finish current discovery work or resolve ownership before activating Development." })); return; }
        opening.current = true;
        try {
            const response = await fetch("/api/development/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retry }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Development could not activate.");
            setView(v => ({ ...v, active: true, error: "" }));
            send({ type: "command", command: "development-target" });
        } catch (error) { setView(v => ({ ...v, error: error instanceof Error ? error.message : "Development activation failed." })); }
        finally { opening.current = false; }
    }
    useEffect(() => {
        let disposed = false;
        if (state.provider?.canSubmitAnswers === false) return;
        void (async () => {
            try {
                const response = await fetch("/api/development/view", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || "Project conversation could not load.");
                const url = new URL(result.url);
                if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.origin === location.origin
                    || typeof result.channel !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(result.channel)) throw new Error("Invalid project presentation binding.");
                if (!disposed) setView(v => ({ ...v, url: url.href, channel: result.channel }));
            } catch (error) { if (!disposed) setView(v => ({ ...v, error: error instanceof Error ? error.message : "Conversation unavailable." })); }
        })();
        return () => { disposed = true; };
    }, [state.provider?.canSubmitAnswers]);
    useEffect(() => { sync(); }, [state, pending, view.url, view.active, designVisible]);
    useEffect(() => { if (designVisible) setView(v => v.designChanged ? { ...v, designChanged: false } : v); }, [designVisible]);
    useEffect(() => {
        const receive = (event: MessageEvent) => {
            const { state, pending, view, post } = latest.current;
            if (!view.url || event.source !== frame.current?.contentWindow || event.origin !== new URL(view.url).origin
                || event.data?.protocol !== "tandem-project/v1" || event.data.channel !== view.channel) return;
            const message = event.data;
            if (message.type === "ready") { sync(); return; }
            if (message.type === "show-design") { latest.current.showDesign(); return; }
            if (message.type === "settings-closed") { document.getElementById("project-settings")?.focus(); return; }
            if (message.type === "activate") { void activate(message.retry === true); return; }
            if (message.type === "status" && typeof message.status === "string") {
                setView(v => ({ ...v, status: message.status.slice(0, 80), detail: typeof message.reason === "string" ? message.reason.slice(0, 2000) : "",
                    active: message.active === true,
                    designRevision: typeof message.designRevision === "string" ? message.designRevision : null,
                    designChanged: !latest.current.designVisible && Boolean(message.designRevision)
                        && (v.designChanged || v.designRevision !== message.designRevision),
                    attention: [message.questions, message.permissions, message.confirmations].reduce((n, x) => n + (Number.isSafeInteger(x) && x > 0 ? x : 0), 0) }));
                return;
            }
            if (!["discovery-send", "discovery-status"].includes(message.type) || typeof message.id !== "string" || message.id.length > 100) return;
            const reply = (ok: boolean, error?: string) => send({ type: "discovery-result", id: message.id, ok, error });
            let submission = submissions.current.get(message.id);
            if (message.type === "discovery-status") {
                if (!submission) send({ type: "discovery-unknown", id: message.id });
                else void submission.work.then(() => reply(true), error => reply(false, error instanceof Error ? error.message : "Submission failed."));
                return;
            }
            if (submission && (submission.key !== message.key || submission.text !== message.text)) {
                reply(false, "This submission ID is already bound to different content."); return;
            }
            if (!submission) {
                const work = (async () => {
                    const context = projectDiscovery(state, pending);
                    if (message.key !== context.key || !context.enabled) throw new Error("The discovery target changed or is unavailable. Review it before sending.");
                    if (typeof message.text !== "string" || !message.text.trim() || message.text.length > 4000) throw new Error("Enter between 1 and 4,000 characters.");
                    const text = message.text.trim();
                    if (context.action === "goal") await post("/api/effort/start", { generation: state.generation, expectedRevision: state.revision, goal: text });
                    else if (context.action === "usage") await post("/api/answer", { questionId: "usage-intake", answer: text, action: "add-usage" });
                    else if (context.action === "sketch") await post("/api/sketch", { action: "revise", expectedRevision: state.sketch.current?.id ?? null, expectedGeneration: state.generation, instruction: text });
                    else if (context.action === "prototype") await post("/api/revision", { suggestion: text, clientRequestId: message.id,
                        baseCheckpointId: state.prototypeFlow?.displayedCheckpointId ?? null });
                })();
                submission = { key: message.key, text: message.text, work };
                submissions.current.set(message.id, submission);
            }
            void submission.work.then(() => reply(true), error => reply(false, error instanceof Error ? error.message : "Submission failed."));
        };
        window.addEventListener("message", receive);
        return () => window.removeEventListener("message", receive);
    }, []);
    return <Context.Provider value={{ ...view, frame, sync, activate, command: command => send({ type: "command", command }) }}>{children}</Context.Provider>;
}
export function ProjectConversation() {
    const view = useProjectView();
    const drag = useRef<number | null>(null);
    const resize = (delta: number) => {
        const panel = document.getElementById("project-conversation");
        const workspace = document.getElementById("studio-workspace");
        if (!panel || !workspace || window.innerWidth < 1000) return;
        const width = Math.max(300, Math.min(workspace.clientWidth - 500, panel.getBoundingClientRect().width + delta));
        workspace.style.setProperty("--conversation-width", `${width}px`);
    };
    return <><div id="project-conversation-divider" role="separator" tabIndex={0} aria-label="Resize artifact and conversation"
        aria-orientation="vertical" aria-controls="preview-pane project-conversation"
        onKeyDown={event => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { resize(event.key === "ArrowLeft" ? 24 : -24); event.preventDefault(); } }}
        onPointerDown={event => { if (event.button === 0) { drag.current = event.clientX; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); } }}
        onPointerMove={event => { if (drag.current !== null) { resize(drag.current - event.clientX); drag.current = event.clientX; } }}
        onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onLostPointerCapture={() => { drag.current = null; }} />
      <aside id="project-conversation" aria-label="Project conversation">
        <div className="project-conversation-heading"><strong>Project conversation</strong>
            <span role="status">{view.status}{view.attention ? ` · ${view.attention} needs attention` : ""}</span>
            <button type="button" onClick={() => view.command("current-work")}>Current work</button></div>
        {(view.error || view.detail) && <p role="alert">{view.error || view.detail}</p>}
        {view.url ? <iframe ref={view.frame} id="project-conversation-frame" title="Persistent project conversation"
            src={`${view.url}?panel=workspace`} onLoad={view.sync} allow="clipboard-read; clipboard-write" />
            : <p role="status">{view.error || "Loading project conversation without activating Development..."}</p>}
    </aside></>;
}
