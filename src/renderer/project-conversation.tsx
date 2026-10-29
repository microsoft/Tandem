import { Button, Disclosure, NativeDialog } from "./ui/index.js";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { canOpenDevelopment, hasActiveJobs, useUi, type UiState } from "./ui-context.js";
import { ProjectEffortError, requestProjectEffort, useProviderReload } from "./project-effort.js";
import type { LifecycleStageId } from "../types.js";
import type { StartingPath } from "../project-entry.js";
import { useDevelopmentGit } from "./development-git.js";
import { validHandoffActivity, validHandoffDesign, type HandoffActivity, type HandoffDesign } from "../../development/tandem/public/handoff-presentation.js";
import { validDevelopmentStatus, type DevelopmentStatus } from "../../development/tandem/public/development-status.js";
import { changeRequestActionLabel, changeRequestResponse, changeRequestStatus } from "./change-request-feedback.js";
import { currentChangeReview } from "../change-request-policy.js";
import { validModelSelection, type ModelSelection } from "../../development/tandem/public/model-selection.js";

type Entry = { id: string; kind: "user" | "status"; role: string; text: string; timestamp: string; changeRequestId?: string };
export function projectDiscovery(state: UiState, busy: boolean, viewedStage: LifecycleStageId = state.lifecycle.currentStage) {
    const stage = state.lifecycle.currentStage;
    const writable = state.provider?.canSubmitAnswers !== false && !state.effortReset && !busy && !currentChangeReview(state);
    const active = hasActiveJobs(state);
    const action = viewedStage !== stage ? "none" : !state.goal.trim() ? "goal" : stage === "requirements" && state.requirements.substage === "usage" ? "usage"
        : stage === "requirements" && state.requirements.substage === "dag" ? "change"
        : stage === "sketch" ? "sketch" : stage === "prototype" ? "prototype" : "none";
    const label = { goal: "Start discovery", usage: "Add requirement usage", sketch: "Revise saved designs",
        prototype: "Prototype feedback", change: "Request a requirement change", none: "Discovery (use artifact controls)" }[action];
    const key = JSON.stringify([state.prototypeId, state.generation, viewedStage, action, state.sketch?.current?.id,
        state.prototypeFlow?.displayedCheckpointId, state.lifecycle.completedStages]);
    return { stage: viewedStage, action, key, label, enabled: writable && action !== "none" && !state.lifecycle.completedStages.includes(stage)
        && (action === "prototype" ? state.processing?.action !== "generate-design-spec" : !active),
        help: action === "change" ? "Review a scoped requirements change without repeating completed decisions."
            : action === "sketch" ? "Revise the saved design revision; unsaved canvas edits are not included."
            : action === "prototype" ? "Queue feedback against the displayed prototype. Applying an update remains explicit."
                : action === "usage" ? "Add a first-person usage to Requirements. Answer existing questions in the Requirements view."
                    : action === "goal" ? "Start optional discovery with this goal. This runs Preparation, not implementation."
                        : "Browse the saved evidence or answer/confirm using this phase's controls." };
}
export function discoveryEntries(state: UiState): Entry[] {
    const entries: Entry[] = [];
    const push = (id: string, kind: Entry["kind"], text: string, timestamp = state.updatedAt, changeRequestId?: string) => {
        if (text) entries.push({ id: `discovery:${state.generation}:${id}`, kind, role: "Discovery evidence", text: text.slice(0, 20000), timestamp,
            ...(changeRequestId ? { changeRequestId } : {}) });
    };
    push("goal", "user", state.goal);
    state.requirements.usageItems.forEach((text, index) => push(`usage:${index}`, "user", text));
    state.decisionGraph.nodes.filter(node => node.answer).forEach(node =>
        push(`answer:${node.id}`, "status", `${node.title}\n${node.answer}`));
    for (const request of state.sketch.requests ?? []) {
        push(`drawing-request:${request.requestId}`, request.kind === "revise" ? "user" : "status", request.instruction, request.requestedAt);
    }
    for (const checkpoint of state.prototypeFlow?.checkpoints ?? []) {
        const scope = checkpoint.visual?.operation === "explore" || checkpoint.visual?.operation === "refine"
            ? "Visual alternatives (not accepted)" : checkpoint.visual?.operation === "choose" ? "Chosen visual direction" : checkpoint.milestone;
        push(`checkpoint:${checkpoint.id}`, "status", `${scope}: ${checkpoint.status}${checkpoint.visualDismissedAt ? " (put aside)" : ""}. ${checkpoint.summary || ""}`,
            checkpoint.completedAt || checkpoint.requestedAt);
    }
    for (const revision of state.prototypeReview?.revisions ?? []) {
        push(`revision:${revision.id}`, "user", revision.visualSelection
            ? `Visual feedback for ${revision.visualSelection.directionId} (${revision.status}): ${revision.suggestion}` : revision.suggestion);
    }
    for (const output of state.lifecycle.outputs) push(`saved:${output.path}`, "status", `Saved ${output.stageId}: ${output.path}`, output.completedAt);
    for (const receipt of state.factoryRuns ?? []) if (receipt.recovery) {
        push(`recovery:${receipt.recovery.decisionId}`, "status",
            `Request ${receipt.requestId} explicitly abandoned with uncertain outcome. Saved work retained; nothing replayed.`,
            receipt.recovery.recordedAt);
    }
    for (const request of state.changeRequests ?? []) {
        push(`change:${request.id}`, "user", [
            request.message, changeRequestStatus(request), changeRequestResponse(request),
            ...request.clarifications.map(item => `${item.question}\n${item.answer}`),
        ].join("\n\n"), request.submittedAt, request.id);
    }
    return entries.slice(-1000);
}

export interface ProjectOutput { id: string; group: "Design" | "Plan" | "Implementation" | "Review"; title: string; detail: string; binding: string }
interface ProjectView {
    visible: boolean;
    settingsOpen: boolean;
    workspaceRequested: boolean;
    url: string | null; channel: string; error: string; active: boolean; starting: boolean; developmentEntered: boolean;
    status: string; detail: string; designRevision: string | null; designChanged: boolean; attention: number;
    maintenanceError: string;
    handoffActivity: HandoffActivity[] | null; designBinding: HandoffDesign | null;
    setHandoffStatusOwner(requestId: string | null): void;
    permissions: number;
    activeRequestId: string | null;
    compacting: boolean;
    presentation: DevelopmentStatus | null;
    modelSelection: ModelSelection | null;
    recoveryAction: "initial-creation" | "empty-setup" | null;
    activate(retry?: boolean): Promise<void>; command(command: string): void;
    outputs: ProjectOutput[]; outputStatus: string; outputReason: string; outputError: string; selectedOutput: string | null;
    openOutput(item: ProjectOutput): void;
    prepareDevelopmentView(): void;
    resumeDiscovery(): void;
    entry: { loading: boolean; busy: boolean; projectPath: string; startingPath: StartingPath | null; error: string; ready: boolean };
    chooseEntry(path: StartingPath): Promise<void>; reloadEntry(): Promise<void>;
    gitSetupVisible: boolean; requireDevelopmentGit(): Promise<boolean>;
    frame: React.RefObject<HTMLIFrameElement | null>; sync(): void;
}
const Context = createContext<ProjectView | null>(null);
export const useProjectView = () => {
    const value = useContext(Context);
    if (!value) throw new Error("Project presentation is unavailable.");
    return value;
};
export function ProjectConversationProvider({ children, designVisible, viewedStage, showDesign, onEntry, effortBusy }: {
    children: ReactNode; designVisible: boolean; viewedStage: LifecycleStageId; showDesign(): void; effortBusy: boolean;
    onEntry(path: StartingPath, firstChoice: boolean): void;
}) {
    const { state, post, pending, setBusy, browseStage } = useUi();
    const [view, setView] = useState({ url: null as string | null, channel: "", error: "", active: false, starting: false, developmentEntered: false,
        status: "Not activated", detail: "", designRevision: null as string | null, designChanged: false, attention: 0,
        handoffActivity: null as HandoffActivity[] | null, designBinding: null as HandoffDesign | null, permissions: 0, activeRequestId: null as string | null, compacting: false,
        presentation: null as DevelopmentStatus | null,
        modelSelection: null as ModelSelection | null,
        recoveryAction: null as ProjectView["recoveryAction"],
        presentationScope: "",
        outputs: [] as ProjectOutput[], outputStatus: "unverified", outputReason: "Development outputs have not been verified.",
        outputError: "", selectedOutput: null as string | null });
    const frame = useRef<HTMLIFrameElement>(null);
    const workspaceRequested = useRef(false);
    const settingsFrame = useRef<HTMLIFrameElement>(null);
    const settingsDialog = useRef<HTMLDialogElement>(null);
    const [handoffStatusOwner, setHandoffStatusOwner] = useState<string | null>(null);
    const providerReload = useProviderReload(view.active || view.starting || view.status === "unknown" || effortBusy);
    const [entry, setEntry] = useState({ loading: true, busy: false, projectPath: state.projectPath ?? "", startingPath: null as StartingPath | null, error: "", ready: false });
    const choosing = useRef(false);
    const git = useDevelopmentGit();
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsRequested, setSettingsRequested] = useState(false);
    const [settingsScope, setSettingsScope] = useState("");
    function openSettings() { setSettingsScope(crypto.randomUUID()); setSettingsRequested(true); setSettingsOpen(true); setViewRequested(true); }
    function closeSettings() { setSettingsOpen(false); setSettingsScope(""); }
    useEffect(() => {
        const dialog = settingsDialog.current;
        if (!dialog) return;
        if (settingsOpen) {
            if (!dialog.open) dialog.showModal();
        } else {
            if (dialog.open) dialog.close();
            document.getElementById("project-settings")?.focus();
        }
    }, [settingsOpen, settingsRequested]);
    const [viewRequested, setViewRequested] = useState(false);
    const pendingCommand = useRef<string | null>(null);
    const entryCallback = useRef(onEntry); entryCallback.current = onEntry;
    const latest = useRef({ state, post, pending, view, designVisible, viewedStage, showDesign, setBusy, browseStage, providerReload, handoffStatusOwner, settingsScope }); latest.current = { state, post, pending, view, designVisible, viewedStage, showDesign, setBusy, browseStage, providerReload, handoffStatusOwner, settingsScope };
    const opening = useRef(false), submissions = useRef(new Map<string, { key: string; text: string; work: Promise<void> }>());
    const startRequested = useRef(false);
    const effortApplying = useRef(false);
    async function loadEntry(firstChoice = false, choice?: StartingPath) {
        if (choosing.current) return;
        choosing.current = true;
        setEntry(v => ({ ...v, busy: true, error: "" }));
        try {
            if (choice && !await git.requireReady()) {
                setEntry(v => ({ ...v, loading: false, busy: false }));
                return;
            }
            const response = await fetch("/api/project-entry", choice ? { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ startingPath: choice }) } : undefined);
            const value = await response.json();
            if (!response.ok || value.error) throw new Error(value.error || "Project metadata could not be read.");
            if (typeof value.projectPath !== "string" || ![null, "preparation", "development"].includes(value.startingPath)) throw new Error("Invalid project entry metadata.");
            let starting = false, developmentEntered = false;
            if (value.startingPath && latest.current.state.provider?.canSubmitAnswers !== false) {
                const needsDevelopment = value.startingPath === "development"
                    || latest.current.state.lifecycle.currentStage === "development" && Boolean(latest.current.state.development);
                if (needsDevelopment) closeSettings();
                if (choice !== "development" && needsDevelopment && !await git.requireReady()) {
                    setEntry({ loading: false, busy: false, projectPath: value.projectPath, startingPath: value.startingPath,
                        error: "", ready: value.startingPath === "preparation" });
                    if (value.startingPath === "preparation") entryCallback.current(value.startingPath, firstChoice);
                    return;
                }
                const opened = await fetch("/api/project-entry/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
                const result = await opened.json();
                if (!opened.ok) throw new Error(result.error || "Project entry could not be prepared.");
                starting = result.developmentStarted === true;
                developmentEntered = result.developmentContext === true;
            }
            setEntry({ loading: false, busy: false, projectPath: value.projectPath, startingPath: value.startingPath, error: "", ready: Boolean(value.startingPath) });
            if (value.startingPath) entryCallback.current(value.startingPath, firstChoice);
            if (developmentEntered) { workspaceRequested.current = true; setViewRequested(true); setView(v => ({ ...v, developmentEntered: true })); }
            if (starting) {
                startRequested.current = true;
                setView(v => ({ ...v, starting: true }));
            }
        } catch (error) {
            setEntry(v => ({ ...v, loading: false, busy: false, ready: false, error: error instanceof Error ? error.message : "Project entry failed." }));
        } finally { choosing.current = false; }
    }
    useEffect(() => { void loadEntry(); }, []);
    function send(value: { type: string; [key: string]: unknown }) {
        const { url, channel } = latest.current.view;
        if (url) {
            const message = { protocol: "tandem-project/v1", channel, ...value };
            frame.current?.contentWindow?.postMessage(message, new URL(url).origin);
            if (["context", "layout", "appearance", "project-effort-result", "project-reload-result"].includes(value.type)) {
                settingsFrame.current?.contentWindow?.postMessage(message, new URL(url).origin);
            }
        }
    }
    useEffect(() => {
        if (settingsOpen && view.url) settingsFrame.current?.contentWindow?.postMessage({
            protocol: "tandem-project/v1", channel: view.channel, type: "command", command: "settings-refresh",
        }, new URL(view.url).origin);
    }, [settingsOpen, view.url]);
    function sync() {
        const { state, pending, view, designVisible } = latest.current;
        const workingStage = view.developmentEntered ? "development" : state.lifecycle.currentStage;
        const viewLabel = { prepare: "Preparation", requirements: "Requirements", sketch: "Designs", prototype: "Prototype", development: "Development" }[workingStage];
        send({ type: "context", entries: [], discovery: projectDiscovery(state, pending, workingStage), viewedStage: workingStage, viewLabel,
            statusScope: JSON.stringify([state.prototypeId, state.generation]), statusBarOwner: designVisible,
            developmentEntered: view.developmentEntered,
            handoffStatusOwner: latest.current.handoffStatusOwner,
            modelSelectionRequested: false,
            settingsScope: latest.current.settingsScope,
            canActivate: canOpenDevelopment(state), developmentActive: view.active, designVisible,
            developmentEnabled: canOpenDevelopment(state), starting: view.starting,
            canChangeEffort: state.provider?.canSubmitAnswers !== false && !pending,
            providerReload: latest.current.providerReload.view });
        syncLayout();
    }
    function syncLayout() {
        const workspace = document.getElementById("studio-workspace");
        if (!workspace) return;
        const columns = getComputedStyle(workspace).gridTemplateColumns.split(/\s+/);
        const conversationWidth = columns.length === 5 ? parseFloat(columns[4]!)
            : window.innerWidth >= 800 ? parseFloat(workspace.style.getPropertyValue("--conversation-width")) || 300 : 0;
        const divider = document.getElementById("project-conversation-divider");
        if (divider && conversationWidth > 0) {
            divider.setAttribute("aria-valuenow", String(Math.round(conversationWidth)));
            divider.setAttribute("aria-valuemax", String(Math.round(workspace.clientWidth - parseFloat(columns[0]!) - 287)));
            divider.setAttribute("aria-valuetext", `Conversation ${Math.round(conversationWidth)} pixels`);
        }
        // Development owns its split inside the iframe, not the root's Discovery history track.
        const developmentWidth = parseFloat(workspace.style.getPropertyValue("--development-conversation-width"));
        send({ type: "layout", stacked: (frame.current?.clientWidth ?? 0) <= 660,
            conversationWidth: Number.isFinite(developmentWidth) ? developmentWidth : null });
    }
    async function activate(retry = false) {
        if (!canOpenDevelopment(latest.current.state)) { setView(v => ({ ...v, error: "Finish current discovery work or resolve ownership before activating Development." })); return; }
        if (opening.current) return;
        opening.current = true;
        try {
            closeSettings();
            if (startRequested.current || latest.current.view.active) {
                workspaceRequested.current = true;
                setView(v => ({ ...v, developmentEntered: true }));
                return;
            }
            if (!await git.requireReady()) return;
            if (!canOpenDevelopment(latest.current.state)) throw new Error("Project ownership or discovery work changed. Review it before entering Development.");
            workspaceRequested.current = true;
            setViewRequested(true);
            startRequested.current = true;
            setView(v => ({ ...v, starting: true, developmentEntered: true, error: "", detail: "", presentation: null, presentationScope: "" }));
            const response = await fetch("/api/development/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retry }) });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "Development could not activate.");
        } catch (error) {
            startRequested.current = false;
            setView(v => ({ ...v, starting: false, error: error instanceof Error ? error.message : "Development could not start." }));
        }
        finally { opening.current = false; }
    }
    useEffect(() => {
        let disposed = false;
        if (!viewRequested || state.provider?.canSubmitAnswers === false) return;
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
    }, [entry.ready, viewRequested, state.provider?.canSubmitAnswers]);
    useEffect(() => { sync(); }, [state, pending, view.url, view.active, view.starting, view.developmentEntered, designVisible, viewedStage, handoffStatusOwner, settingsScope, JSON.stringify(providerReload.view)]);
    useEffect(() => {
        const observer = new ResizeObserver(syncLayout);
        const workspace = document.getElementById("studio-workspace");
        if (workspace) observer.observe(workspace);
        if (frame.current) observer.observe(frame.current);
        window.addEventListener("resize", syncLayout);
        return () => { observer.disconnect(); window.removeEventListener("resize", syncLayout); };
    }, [view.url]);
    useEffect(() => { if (designVisible) setView(v => v.designChanged ? { ...v, designChanged: false } : v); }, [designVisible]);
    useEffect(() => {
        const receive = (event: MessageEvent) => {
            const { state, pending, view, post } = latest.current;
            const fromSettings = event.source === settingsFrame.current?.contentWindow && Boolean(settingsFrame.current);
            const fromWorkspace = event.source === frame.current?.contentWindow && Boolean(frame.current);
            if (!view.url || !fromSettings && !fromWorkspace || event.origin !== new URL(view.url).origin
                || event.data?.protocol !== "tandem-project/v1" || event.data.channel !== view.channel) return;
            const message = event.data;
            if (fromSettings && !["ready", "settings-closed", "appearance", "project-effort-read", "project-effort-apply", "project-reload", "model-selection-readiness"].includes(message.type)) return;
            if (message.type === "model-selection-readiness") {
                return;
            }
            if (message.type === "project-reload" && typeof message.id === "string" && message.id.length > 0 && message.id.length <= 100
                && typeof message.scope === "string" && message.scope.length <= 1024) {
                void latest.current.providerReload.reload(message.scope).then(result =>
                    send({ type: "project-reload-result", id: message.id, ...result }));
                return;
            }
            if (message.type === "outputs") {
                if (!["verified", "unverified", "not-started"].includes(message.status) || typeof message.reason !== "string"
                    || !Array.isArray(message.items) || message.items.length > 10000
                    || !message.items.every((item: ProjectOutput) => item && ["Design", "Plan", "Implementation", "Review"].includes(item.group)
                        && ["id", "title", "detail", "binding"].every(key => typeof item[key as keyof ProjectOutput] === "string"
                            && item[key as keyof ProjectOutput].length <= 10000))
                    || new Set(message.items.map((item: ProjectOutput) => item.id)).size !== message.items.length) {
                    setView(v => ({ ...v, outputStatus: "unverified", outputError: "Development output index is invalid; nothing was opened." }));
                    return;
                }
                setView(v => {
                    const items = message.status === "verified" ? message.items : v.outputs;
                    const selected = message.status === "verified" ? typeof message.selected === "string" ? message.selected : null : v.selectedOutput;
                    if (v.outputStatus === message.status && v.outputReason === message.reason && v.selectedOutput === selected
                        && JSON.stringify(v.outputs) === JSON.stringify(items)) return v;
                    return { ...v, outputs: items, outputStatus: message.status, outputReason: message.reason, selectedOutput: selected };
                });
                return;
            }
            if (message.type === "output-opened") {
                if (typeof message.error === "string") setView(v => ({ ...v, outputError: message.error }));
                else if (latest.current.view.outputs.some(item => item.id === message.id && item.binding === message.binding)) {
                    setView(v => ({ ...v, selectedOutput: message.id, outputError: "" }));
                }
                return;
            }
            if (message.type === "ready") {
                sync();
                if (!fromSettings && pendingCommand.current) { send({ type: "command", command: pendingCommand.current }); pendingCommand.current = null; }
                return;
            }
            if (message.type === "view-stage" && ["prepare", "requirements", "sketch", "prototype", "development"].includes(message.stage)) {
                latest.current.browseStage(message.stage);
                return;
            }
            if (message.type === "show-design") { latest.current.showDesign(); return; }
            if (message.type === "settings-open") { openSettings(); return; }
            if (message.type === "settings-closed") { closeSettings(); return; }
            if (message.type === "conversation-resize"
                && (message.width === null || Number.isFinite(message.width) && message.width >= 300
                    && message.width <= window.innerWidth)) {
                const style = document.getElementById("studio-workspace")?.style;
                if (message.width === null) style?.removeProperty("--development-conversation-width");
                else style?.setProperty("--development-conversation-width", `${message.width}px`);
                syncLayout();
                return;
            }
            if (message.type === "appearance" && ["system", "light", "dark"].includes(message.theme)
                && ["normal", "larger", "largest"].includes(message.fontSize)) {
                document.documentElement.dataset.projectTheme = message.theme;
                document.documentElement.dataset.projectFontSize = message.fontSize;
                send({ type: "appearance", theme: message.theme, fontSize: message.fontSize });
                return;
            }
            if (["project-effort-read", "project-effort-apply"].includes(message.type)) {
                if (typeof message.id !== "string" || message.id.length > 100) return;
                const applying = message.type === "project-effort-apply";
                if (applying && (typeof message.effort !== "string" || message.effort.length > 40
                    || effortApplying.current || latest.current.pending || state.provider?.canSubmitAnswers === false)) {
                    send({ type: "project-effort-result", id: message.id, error: "Project effort cannot change while work or ownership is pending." }); return;
                }
                if (applying) { effortApplying.current = true; latest.current.setBusy("project-effort", true); }
                void requestProjectEffort(applying ? message.effort : undefined)
                    .then(settings => send({ type: "project-effort-result", id: message.id, settings }))
                    .catch(error => send({ type: "project-effort-result", id: message.id,
                        error: error instanceof Error ? error.message : "Project effort request failed.",
                        settings: error instanceof ProjectEffortError ? error.settings : undefined }))
                    .finally(() => { if (applying) { effortApplying.current = false; latest.current.setBusy("project-effort", false); } });
                return;
            }
            if (message.type === "activate") { void activate(message.retry === true); return; }
            if (message.type === "status" && typeof message.status === "string") {
                if (message.statusScope !== undefined && message.statusScope !== null
                    && message.statusScope !== JSON.stringify([state.prototypeId, state.generation])) return;
                const recoveryAction = message.starting !== true && message.statusScope === JSON.stringify([state.prototypeId, state.generation])
                    ? message.canInspectInitialRecovery === true ? "initial-creation" : message.canInspectEmptyRepair === true ? "empty-setup" : null : null;
                const retryable = message.starting !== true && !recoveryAction && (message.canRetry === true || message.canReopen === true
                    || message.canRetry === undefined && message.canReopen === undefined && ["failed", "unknown", "closed"].includes(message.installationStatus));
                const settled = message.active === true || retryable || recoveryAction !== null
                    || message.starting !== true && ["failed", "unknown", "closed", "saved-state"].includes(message.installationStatus);
                if (settled) startRequested.current = false;
                setView(v => ({ ...v, status: message.status.slice(0, 80), recoveryAction,
                    detail: recoveryAction ? `Use ${recoveryAction === "initial-creation" ? "Inspect unused setup recovery" : "Repair Development setup"} in the Development conversation pane. The saved handoff has not been submitted.`
                        : typeof message.reason === "string" ? message.reason.slice(0, 2000) : "",
                    modelSelection: validModelSelection(message.modelSelection) ? message.modelSelection : null,
                    handoffActivity: Array.isArray(message.handoffActivity) && message.handoffActivity.length <= 100
                        && message.handoffActivity.every(validHandoffActivity) ? message.handoffActivity : null,
                    designBinding: validHandoffDesign(message.designBinding) ? message.designBinding : null,
                    permissions: Number.isSafeInteger(message.permissions) && message.permissions > 0 ? message.permissions : 0,
                    activeRequestId: typeof message.activeRequestId === "string" ? message.activeRequestId.slice(0, 200) : null,
                    compacting: message.compacting === true,
                    presentation: message.statusScope === JSON.stringify([state.prototypeId, state.generation])
                        && validDevelopmentStatus(message.presentation)
                        && (message.presentation.kind !== "active" || message.presentation.requestId === (message.activeRequestId ?? null))
                        ? message.presentation : null,
                    presentationScope: typeof message.statusScope === "string" ? message.statusScope : "",
                    active: message.active === true,
                    starting: message.starting === true || !settled && v.starting,
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
                    if (latest.current.view.developmentEntered) throw new Error("Use the owning phase's original input; Development cannot submit discovery work.");
                    const context = projectDiscovery(state, pending);
                    if (message.key !== context.key || !context.enabled) throw new Error("The discovery target changed or is unavailable. Review it before sending.");
                    if (typeof message.text !== "string" || !message.text.trim() || message.text.length > 4000) throw new Error("Enter between 1 and 4,000 characters.");
                    const text = message.text.trim();
                    if (context.action === "goal") await post("/api/effort/start", { generation: state.generation, expectedRevision: state.revision, goal: text });
                    else if (context.action === "usage") await post("/api/answer", { questionId: "usage-intake", answer: text, action: "add-usage" });
                    else if (context.action === "change") await post("/api/change-requests", { message: text, clientRequestId: message.id,
                        originStage: context.stage, expectedGeneration: state.generation });
                    else if (context.action === "sketch") await post("/api/sketch", { action: "revise", clientRequestId: message.id,
                        expectedRevision: state.sketch.current?.id ?? null, expectedGeneration: state.generation, instruction: text });
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
    return <Context.Provider value={{ ...view, maintenanceError: providerReload.view.error ? providerReload.view.message : "",
        presentation: view.presentationScope === JSON.stringify([state.prototypeId, state.generation]) ? view.presentation : null,
        recoveryAction: view.presentationScope === JSON.stringify([state.prototypeId, state.generation]) ? view.recoveryAction : null,
        detail: !view.presentationScope || view.presentationScope === JSON.stringify([state.prototypeId, state.generation]) ? view.detail : "",
        visible: designVisible, settingsOpen, workspaceRequested: workspaceRequested.current, entry, chooseEntry: path => loadEntry(true, path), reloadEntry: () => loadEntry(),
        gitSetupVisible: git.visible, requireDevelopmentGit: git.requireReady,
        frame, sync, activate, setHandoffStatusOwner,
        prepareDevelopmentView: () => { workspaceRequested.current = true; setViewRequested(true); setView(v => ({ ...v, developmentEntered: true })); },
        resumeDiscovery: () => setView(v => ({ ...v, developmentEntered: false })),
        command: command => {
            if (command === "settings") { openSettings(); return; }
            if (!latest.current.designVisible || !latest.current.view.developmentEntered) {
                if (command === "current-work") {
                    if (latest.current.view.developmentEntered) latest.current.showDesign();
                    else latest.current.browseStage(latest.current.state.lifecycle.currentStage);
                }
            } else if (!latest.current.view.url) { pendingCommand.current = command; setViewRequested(true); }
            else send({ type: "command", command });
        },
        openOutput: item => {
            if (latest.current.view.outputStatus !== "verified") return;
            latest.current.showDesign();
            send({ type: "output-open", id: item.id, binding: item.binding });
        } }}>{children}{git.dialog}{settingsRequested && <NativeDialog ref={settingsDialog}
              role="dialog" aria-labelledby="project-settings-title" aria-describedby="project-settings-description"
              className="dialog-content project-settings-dialog" hidden={!settingsOpen}
              onCancel={event => { event.preventDefault(); closeSettings(); }}
              onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); closeSettings(); } }}>
              <div className="root-settings-heading"><h2 id="project-settings-title">Project settings</h2>
                <Button variant="secondary" id="close-project-settings" className="plan-button secondary" onClick={closeSettings}>Close</Button></div>
              <p id="project-settings-description">Shared project preferences and optional private Development model override.
                Without an override, Development inherits the main model at first creation, then stays independent.
                Opening settings does not start Development.</p>
              {state.provider?.canSubmitAnswers === false ? <p role="status">Open Project settings in the Tandem session that owns this project.</p>
                : view.url ? <iframe ref={settingsFrame} id="project-settings-frame" title="Project settings controls"
                    src={`${view.url}?panel=settings`} onLoad={sync} />
                  : <p role={view.error ? "alert" : "status"}>{view.error || "Loading project settings..."}</p>}
        </NativeDialog>}
    </Context.Provider>;
}
export function ProjectConversation() {
    const view = useProjectView();
    const { state, changeRequestDialog } = useUi();
    const [historyChoice, setHistoryChoice] = useState<boolean | null>(null);
    const [narrowHistory, setNarrowHistory] = useState(() => window.innerWidth < 1000);
    const historyCollapsed = historyChoice ?? narrowHistory;
    useEffect(() => {
        const resize = () => setNarrowHistory(window.innerWidth < 1000);
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, []);
    useEffect(() => {
        const workspace = document.getElementById("studio-workspace");
        if (workspace) workspace.dataset.historyCollapsed = String(historyCollapsed && !view.visible);
        view.sync();
    }, [historyCollapsed, view.visible]);
    const drag = useRef<number | null>(null);
    const resize = (delta: number) => {
        const panel = document.getElementById("project-conversation");
        const workspace = document.getElementById("studio-workspace");
        if (!panel || !workspace || window.innerWidth < 1000) return;
        const navigationWidth = document.getElementById("requirements-pane")?.getBoundingClientRect().width ?? 220;
        const width = Math.max(300, Math.min(workspace.clientWidth - navigationWidth - 287, panel.getBoundingClientRect().width + delta));
        workspace.style.setProperty("--conversation-width", `${width}px`);
    };
    return <><div id="project-conversation-divider" role="separator" tabIndex={0} aria-label="Resize artifact and conversation"
        aria-orientation="vertical" aria-controls="preview-pane project-conversation" aria-valuemin={300}
        onKeyDown={event => { if (["ArrowLeft", "ArrowRight"].includes(event.key)) { resize(event.key === "ArrowLeft" ? 24 : -24); event.preventDefault(); } }}
        onPointerDown={event => { if (event.button === 0) { event.currentTarget.focus({ preventScroll: true }); drag.current = event.clientX; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); } }}
        onPointerMove={event => { if (drag.current !== null) { resize(drag.current - event.clientX); drag.current = event.clientX; } }}
        onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onLostPointerCapture={() => { drag.current = null; }} />
      <aside id="project-conversation" aria-label="Project conversation" data-history-collapsed={historyCollapsed && !view.visible}>
        {!view.visible && !historyCollapsed && <div className="project-conversation-heading"><strong>Discovery history</strong>
            <Button variant="secondary" type="button" onClick={() => view.command("current-work")}>Current work</Button></div>}
        {!view.visible && <Button variant="secondary" id="toggle-discovery-history" className="plan-button secondary" type="button" aria-controls="discovery-history"
            aria-label={historyCollapsed ? "Show discovery history" : "Hide discovery history"} title={historyCollapsed ? "Show discovery history" : "Hide discovery history"}
            aria-expanded={!historyCollapsed} onClick={() => setHistoryChoice(!historyCollapsed)}>
            {historyCollapsed ? <PanelRightOpen size={16} aria-hidden="true" /> : <><PanelRightClose size={16} aria-hidden="true" />Hide history</>}</Button>}
        {view.visible && view.error && <p role="alert">{view.error}</p>}
        {view.url && view.workspaceRequested && <iframe ref={view.frame} id="project-conversation-frame" title="Private Development conversation"
            hidden={!view.visible} src={`${view.url}?panel=workspace`} onLoad={view.sync} allow="clipboard-read; clipboard-write" />}
        {!view.visible && <div id="discovery-history" className="discovery-history" aria-label="Discovery history" hidden={historyCollapsed}>
                {discoveryEntries(state).map(item => <article key={item.id} data-entry-id={item.id}>
                    <Disclosure><summary>{item.id.endsWith(":goal") ? "Original project brief" : item.text.split("\n")[0]!.slice(0, 100) + (item.text.length > 100 ? "..." : "")}</summary><p>{item.text}</p>
                        {item.changeRequestId && changeRequestDialog && <Button variant="secondary" type="button" className="plan-button secondary"
                            onClick={event => changeRequestDialog.open(item.changeRequestId!, event.currentTarget)}>
                            {changeRequestActionLabel(state.changeRequests!.find(request => request.id === item.changeRequestId)!)}</Button>}
                    </Disclosure>
                </article>)}
                {!state.goal && <p>{view.entry.startingPath === "development" ? "Preparation was not used for this project."
                    : "Project history will appear here. Use Preparation's goal form to begin."}</p>}
              </div>}
    </aside></>;
}
