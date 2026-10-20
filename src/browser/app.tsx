import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { ArrowRight, ArrowUp, FolderOpen, Info, LoaderCircle, RefreshCw, ScrollText, ShieldAlert, ShieldCheck, Square, X } from "lucide-react";
import { BrowserStore } from "./client.js";
import type { BackendCommand, HostCommand, HostRequest, HostSnapshot, WorkspaceListing } from "./contracts.js";
import { Brand } from "../renderer/brand.js";
import { useEmbeddedHeader } from "./embedded-header.js";

function Modal({ title, description, children, close, wide = false }: {
    title: string; description: string; children: ReactNode; close(): void; wide?: boolean;
}) {
    return <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}>
        <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className={`dialog-content host-dialog${wide ? " host-dialog-wide" : ""}`}>
                <Dialog.Title>{title}</Dialog.Title>
                <Dialog.Description>{description}</Dialog.Description>
                {children}
                <Dialog.Close asChild><button type="button" className="host-dialog-close" aria-label="Close dialog"><X size={16} /></button></Dialog.Close>
            </Dialog.Content>
        </Dialog.Portal>
    </Dialog.Root>;
}

function WorkspacePicker({ store, host, close, open }: {
    store: BrowserStore; host: HostSnapshot; close(): void; open(path: string): void;
}) {
    const [path, setPath] = useState(host.workspace || "");
    const [listing, setListing] = useState<WorkspaceListing | null>(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [newFolder, setNewFolder] = useState<string | null>(null);
    const sequence = useRef(0);
    const browse = async (path?: string) => {
        const request = ++sequence.current;
        setBusy(true);
        setError("");
        try {
            const value = await store.directories(path);
            if (request !== sequence.current) return;
            setListing(value);
            setPath(value.path);
        } catch (error) { if (request === sequence.current) setError(error instanceof Error ? error.message : String(error)); }
        finally { if (request === sequence.current) setBusy(false); }
    };
    const createFolder = async () => {
        if (!listing || !newFolder?.trim() || busy) return;
        setBusy(true); setError("");
        const request = ++sequence.current;
        try {
            const value = await store.createDirectory(host.generation, listing.path, newFolder);
            if (request !== sequence.current) return;
            setListing(value); setPath(value.path); setNewFolder(null);
        } catch (error) { if (request === sequence.current) setError(error instanceof Error ? error.message : String(error)); }
        finally { if (request === sequence.current) setBusy(false); }
    };
    useEffect(() => { void browse(host.workspace || undefined); return () => { sequence.current++; }; }, []);
    return <Modal title="Open workspace" description="Choose a local folder. Switching workspaces stops the previous backend and restores Ask each time." close={close} wide>
        <form className="host-folder-path" onSubmit={(event) => { event.preventDefault(); void browse(path); }}>
            <label htmlFor="workspace-path">Folder path</label>
            <div><input id="workspace-path" value={path} disabled={busy} onChange={(event) => setPath(event.target.value)} autoComplete="off" spellCheck={false} />
                <button type="submit" disabled={busy || !path.trim()}>Browse</button></div>
        </form>
        {host.recentWorkspaces.length > 0 && <label className="host-recent">Recent folders
            <select aria-label="Recent folders" value="" disabled={busy} onChange={(event) => { if (event.target.value) void browse(event.target.value); }}>
                <option value="">Select a recent workspace</option>
                {host.recentWorkspaces.map((path) => <option key={path} value={path}>{path}</option>)}
            </select>
        </label>}
        <div className="host-folder-heading"><strong>Folders</strong><div>
            <button type="button" disabled={busy || !listing || path !== listing.path} onClick={() => setNewFolder("")}>New folder</button>
            <button type="button" disabled={busy || !listing?.parent} onClick={() => { if (listing?.parent) void browse(listing.parent); }}><ArrowUp size={14} />Parent folder</button></div></div>
        {newFolder !== null && <form className="host-new-folder" onSubmit={(event) => { event.preventDefault(); void createFolder(); }}>
            <label htmlFor="new-folder-name">New folder name</label><div>
                <input id="new-folder-name" value={newFolder} disabled={busy} onChange={(event) => setNewFolder(event.target.value)} autoFocus />
                <button type="submit" disabled={busy || !newFolder.trim()}>Create folder</button>
                <button type="button" disabled={busy} onClick={() => setNewFolder(null)}>Cancel creation</button>
            </div>
        </form>}
        <div className="host-folder-list" aria-label="Local folders" aria-busy={busy}>
            {busy ? <p role="status">Reading folders...</p> : listing?.directories.length
                ? listing.directories.map((entry) => <button key={entry.path} type="button" onClick={() => void browse(entry.path)}><FolderOpen size={16} />{entry.name}</button>)
                : <p>No subfolders. You can open this folder or enter another path.</p>}
        </div>
        {listing?.truncated && <p role="status">Showing the first 500 folders. Enter a full path to reach another folder.</p>}
        {error && <p className="host-error" role="alert">{error}</p>}
        <div className="dialog-actions"><button type="button" onClick={close}>Cancel</button>
            <button type="button" className="host-primary" disabled={busy || !path.trim()} onClick={() => open(path)}>Open workspace</button></div>
    </Modal>;
}

function RequestDialog({ request, remaining, disabled, reply }: {
    request: HostRequest; remaining: number; disabled: boolean;
    reply(command: Extract<BackendCommand, { type: "permission-response" | "question-response" }>): Promise<void>;
}) {
    const [answer, setAnswer] = useState("");
    const [error, setError] = useState("");
    const [pending, setPending] = useState(false);
    const send = async (value: Parameters<typeof reply>[0]) => {
        if (pending || disabled) return;
        setPending(true); setError("");
        try { await reply(value); }
        catch (error) { setError(error instanceof Error ? error.message : String(error)); }
        finally { setPending(false); }
    };
    const cancel = () => void send(request.type === "permission"
        ? { type: "permission-response", id: request.id, approved: false }
        : { type: "question-response", id: request.id, cancelled: true });
    return <Modal title={request.type === "permission" ? request.title : "Backend question"}
        description={`${remaining > 1 ? `${remaining} requests are waiting. ` : ""}Only your explicit response authorizes this request.`} close={cancel} wide>
        {request.type === "permission" ? <>
            <pre className="host-permission-details" tabIndex={0}>{request.details}</pre>
            {request.canAllowAllForSession && <p>Allow all lets tools run commands, modify files and access the network without further confirmation in this backend session. Managed-policy and sandbox-bypass requests still ask.</p>}
            <div className="dialog-actions host-permission-actions">
                <button type="button" disabled={pending || disabled} onClick={cancel} autoFocus>Deny</button>
                <button type="button" className="host-primary" disabled={pending || disabled}
                    onClick={() => void send({ type: "permission-response", id: request.id, approved: true })}>Allow once</button>
                {request.canAllowAllForSession && <button type="button" disabled={pending || disabled}
                    onClick={() => void send({ type: "permission-response", id: request.id, approved: true, allowAllForSession: true })}>Allow all for this session</button>}
            </div>
        </> : <form onSubmit={(event) => { event.preventDefault(); void send({ type: "question-response", id: request.id, answer }); }}>
            <p>{request.question}</p>
            {request.choices?.length ? <label>Choose an answer<select aria-label="Choose an answer" value={request.choices.includes(answer) ? answer : ""}
                onChange={(event) => setAnswer(event.target.value)}><option value="">Select an answer</option>
                {request.choices.map((choice) => <option key={choice}>{choice}</option>)}</select></label> : null}
            {request.allowFreeform !== false && <label>Written answer<textarea aria-label="Written answer" value={answer} onChange={(event) => setAnswer(event.target.value)} /></label>}
            <div className="dialog-actions"><button type="button" disabled={pending || disabled} onClick={cancel}>Cancel</button>
                <button type="submit" className="host-primary" disabled={pending || disabled || !answer.trim()}>Send answer</button></div>
        </form>}
        {error && <p className="host-error" role="alert">{error}</p>}
        {disabled && <p className="host-error" role="status">Waiting for the host connection before accepting a response.</p>}
    </Modal>;
}

export function BrowserApp({ store, connect = true }: { store: BrowserStore; connect?: boolean }) {
    const { host, connected, error: connectionError } = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const [dialog, setDialog] = useState<"workspace" | "diagnostics" | "about" | null>(null);
    const [confirmation, setConfirmation] = useState<{ title: string; detail: string; command: HostCommand } | null>(null);
    const [diagnostics, setDiagnostics] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [reload, setReload] = useState(0);
    const application = useEmbeddedHeader(host?.canvasUrl, host?.generation, reload, setError);
    useEffect(() => connect ? store.connect() : undefined, [store, connect]);
    useEffect(() => { setError(""); setConfirmation(null); setDialog(null); }, [host?.generation]);
    useEffect(() => {
        if (dialog !== "diagnostics" || !connected) return;
        let active = true;
        let pending = false;
        const timer = setInterval(() => {
            if (pending) return;
            pending = true;
            void store.diagnostics().then((text) => { if (active) setDiagnostics(text); },
                (error: unknown) => { if (active) setError(error instanceof Error ? error.message : String(error)); })
                .finally(() => { pending = false; });
        }, 2000);
        return () => { active = false; clearInterval(timer); };
    }, [dialog, connected, store]);
    const active = connected && host && !["stopping", "stopped"].includes(host.phase);
    const run = async (command: HostCommand) => {
        setBusy(true); setError("");
        try { await store.command(command); setConfirmation(null); }
        catch (error) { setError(error instanceof Error ? error.message : String(error)); }
        finally { setBusy(false); }
    };
    const showDiagnostics = async () => {
        setDialog("diagnostics"); setDiagnostics("Loading diagnostics..."); setError("");
        try { setDiagnostics(await store.diagnostics()); }
        catch (error) { setDiagnostics(""); setError(error instanceof Error ? error.message : String(error)); }
    };
    const open = (path: string) => {
        if (!host) return;
        setDialog(null);
        const command: HostCommand = { type: "open-workspace", workspace: path, generation: host.generation };
        if (host.workspace && !["idle", "error"].includes(host.phase)) {
            setConfirmation({ title: "Switch workspace?", detail: "This stops the current backend and can interrupt active work. Saved artifacts and run history are preserved.", command });
        } else void run(command);
    };
    const request = host?.requests[0];
    const showRequest = request && !dialog && !confirmation;
    const privateDevelopment = application.header?.permissionScope === "development";
    const permissionsDisabled = privateDevelopment || !active || busy || !host?.workspace || host.phase === "error";
    const permissionsTitle = privateDevelopment ? "Development permissions are controlled inside its private session."
        : `Upstream tool permissions: ${host?.permissionMode === "allow-all" ? "Allow all for this session" : "Ask each time"}`;
    const displayedVersion = application.header?.version || host?.version;
    const applicationStatus = application.header?.status;
    return <div className="host-shell">
        <header className="host-header">
            <div className="host-brand"><Brand /></div>
            <span className="host-workspace" title={host?.workspace || ""}>{host?.workspace || "Local browser workspace"}</span>
            {application.header?.lifecycle && <span className="host-lifecycle" aria-label="Development lifecycle" title={application.header.lifecycle}>{application.header.lifecycle}</span>}
            <span className="host-version" title={application.header ? "Tandem application version" : "Tandem host version"}>{displayedVersion ? `v${displayedVersion}` : ""}</span>
            <nav className="host-header-actions" aria-label="Workspace controls">
                <button type="button" className="host-icon-button" aria-label="Open folder" title="Open folder"
                    disabled={!active || busy} onClick={() => setDialog("workspace")}><FolderOpen size={16} aria-hidden="true" /></button>
                <button type="button" className="host-icon-button" aria-label="Reload page" title="Reload page"
                    disabled={!host?.canvasUrl} onClick={() => setReload((value) => value + 1)}><RefreshCw size={16} aria-hidden="true" /></button>
                <label className="host-permissions" title={permissionsTitle} data-mode={host?.permissionMode || "ask"} data-disabled={permissionsDisabled}>
                    {host?.permissionMode === "allow-all" ? <ShieldAlert size={16} aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}
                    <select aria-label="Tool permissions" title={permissionsTitle} value={host?.permissionMode || "ask"}
                        disabled={permissionsDisabled}
                        onChange={(event) => {
                            if (!host) return;
                            if (event.target.value === "ask") void run({ type: "set-permission-mode", mode: "ask", generation: host.generation });
                            else setConfirmation({ title: "Allow all tool actions for this session?",
                                detail: "Copilot may run commands, change files and access the network without further tool confirmation. Only enable this for trusted workspaces. This is not saved: restarting or switching the workspace restores Ask each time. Managed-policy, sandbox-bypass, and microphone consent remain separate.",
                                command: { type: "set-permission-mode", mode: "allow-all", generation: host.generation } });
                        }}>
                        <option value="ask">Ask each time</option><option value="allow-all">Allow all for this session</option>
                    </select>
                </label>
                <button type="button" className="host-icon-button" aria-label="Diagnostics" title="Diagnostics"
                    disabled={!connected} onClick={() => void showDiagnostics()}><ScrollText size={16} aria-hidden="true" /></button>
                <button type="button" className="host-icon-button" aria-label="About" title="About"
                    onClick={() => setDialog("about")}><Info size={16} aria-hidden="true" /></button>
                <button type="button" className="host-icon-button" aria-label="Stop" title="Stop Tandem"
                    disabled={!connected || busy || host?.phase === "stopping"} onClick={() => {
                        if (host) setConfirmation({ title: "Stop Tandem?", detail: "This stops the local backend and its active work. Closing a tab alone does not stop it. Saved workspace state is kept.",
                            command: { type: "stop", generation: host.generation } });
                    }}><Square size={14} aria-hidden="true" /></button>
            </nav>
        </header>
        {(connectionError || error || host?.error) && <div className="host-banner host-error" role="alert">{connectionError || error || host?.error}</div>}
        {application.header?.messages.map((message) => <div key={message.id} className={`host-banner${message.error ? " host-error" : ""}`}
            role={message.error ? "alert" : "status"}>{message.text}</div>)}
        {host?.warning && <div className="host-banner host-warning" role="status">{host.warning}</div>}
        {request && !showRequest && <button className="host-pending" type="button" onClick={() => { setDialog(null); setConfirmation(null); }}>{host.requests.length} backend request(s) need your response</button>}
        <main className="host-main" tabIndex={0} aria-label="Tandem workspace viewport">
            {host?.canvasUrl ? <iframe key={`${host.generation}:${host.canvasUrl}:${reload}`} ref={application.frame} id="tandem-application" title="Tandem workspace"
                src={application.src} onLoad={application.onLoad} referrerPolicy="no-referrer" allow={`microphone ${new URL(host.canvasUrl).origin}`}
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox" />
                : <section className="host-notice" aria-label="Workspace status">
                    {host?.phase === "starting" && <LoaderCircle className="spin" size={28} />}
                    <h1>{host?.phase === "stopped" ? "Tandem stopped" : host?.phase === "error" ? "Workspace unavailable"
                        : host?.phase === "starting" ? "Starting your workspace" : host?.phase === "stopping" ? "Stopping Tandem" : "Welcome to Tandem"}</h1>
                    <p>{host?.status || "Connecting to the local host..."}</p>
                    {!host?.error && <p className="host-muted">Your workspace stays on this computer. Copilot runs independently of the Copilot desktop app.</p>}
                    {host && ["idle", "error"].includes(host.phase) && <div className="host-notice-actions">
                        <button type="button" disabled={!active || busy} onClick={() => setDialog("workspace")}><FolderOpen size={16} />Open folder</button>
                        {host.workspace && <button type="button" className="host-primary" disabled={!active || busy}
                            onClick={() => void run({ type: "retry", generation: host.generation })}><RefreshCw size={16} />Retry</button>}
                    </div>}
                </section>}
        </main>
        <footer className="host-status">
            <span className="host-status-state" role="status" title={host?.status || "Connecting..."}>{host?.status || "Connecting..."}</span>
            {applicationStatus && <div className="host-application-status" data-status={applicationStatus.error ? "error" : "idle"}>
                <span role="status" title={applicationStatus.text}>{applicationStatus.text}</span>
                {applicationStatus.action && <button type="button" className="host-status-action" aria-label="Go to action"
                    title={`Go to action: ${applicationStatus.action}`} onClick={application.showNextAction}><ArrowRight size={13} aria-hidden="true" /></button>}
            </div>}
            <span className="host-status-hint">Tab close keeps running | Stop or Ctrl+C to exit</span>
        </footer>
        {dialog === "workspace" && host && <WorkspacePicker store={store} host={host} close={() => setDialog(null)} open={open} />}
        {dialog === "diagnostics" && <Modal title="Diagnostics" description="Redacted host and backend messages. Workspace logs are in .tandem\desktop\browser.log." close={() => setDialog(null)} wide>
            <pre className="host-log" tabIndex={0}>{diagnostics || "No diagnostic messages."}</pre>
            {error && <p className="host-error" role="alert">{error}</p>}
            <div className="dialog-actions"><button type="button" disabled={!connected} onClick={() => void showDiagnostics()}>Refresh</button><button type="button" onClick={() => setDialog(null)}>Close</button></div>
        </Modal>}
        {dialog === "about" && <Modal title={`Tandem ${host?.version || ""}`} description="Standalone Node.js browser host" close={() => setDialog(null)}>
            <p>The same Tandem workflow and artifacts, without .NET or WebView2. Copilot authentication and network access are required for AI operations.</p>
            <p>Only open workspaces and tools you trust. Tool permissions start in Ask each time; browser microphone permissions are separate.</p>
            <p>Closing a tab leaves the backend running. Use Stop here or Ctrl+C in the terminal to stop it.</p>
            <div className="dialog-actions"><button type="button" onClick={() => setDialog(null)}>Close</button></div>
        </Modal>}
        {confirmation && <Modal title={confirmation.title} description={confirmation.detail} close={() => { if (!busy) setConfirmation(null); }}>
            <div className="dialog-actions"><button type="button" disabled={busy} onClick={() => setConfirmation(null)} autoFocus>Cancel</button>
                <button type="button" className="host-primary" disabled={busy || !connected} onClick={() => void run(confirmation.command)}>Confirm</button></div>
            {error && <p className="host-error" role="alert">{error}</p>}
        </Modal>}
        {showRequest && host && <RequestDialog key={`${host.generation}:${request.id}`} request={request} remaining={host.requests.length}
            disabled={!connected} reply={(command) => store.command({ ...command, generation: host.generation })} />}
    </div>;
}
