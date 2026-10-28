import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowRight, ArrowUp, FolderOpen, Info, LoaderCircle, RefreshCw, ScrollText, ShieldAlert, ShieldCheck, Square, X } from "lucide-react";
import { BrowserStore } from "./client.js";
import type { BackendCommand, HostCommand, HostRequest, HostSnapshot, WorkspaceListing } from "./contracts.js";
import { Brand } from "../renderer/brand.js";
import { useEmbeddedHeader } from "./embedded-header.js";
import { Button, Dialog, FormField, IconButton, Input, Select, Textarea } from "../renderer/ui/index.js";

function Modal({ title, description, children, close, wide = false }: {
    title: string; description: string; children: ReactNode; close(): void; wide?: boolean;
}) {
    return <Dialog open onOpenChange={(open) => { if (!open) close(); }}
        className={`host-dialog${wide ? " host-dialog-wide" : ""}`} title={title} description={description}>
        {children}
        <IconButton className="host-dialog-close" aria-label="Close dialog" onClick={close}><X size={16} aria-hidden="true" /></IconButton>
    </Dialog>;
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
            <FormField id="workspace-path" label="Folder path">{control =>
                <div><Input {...control} value={path} disabled={busy} onChange={(event) => setPath(event.target.value)} autoComplete="off" spellCheck={false} />
                    <Button type="submit" disabled={busy || !path.trim()}>Browse</Button></div>}</FormField>
        </form>
        {host.recentWorkspaces.length > 0 && <label className="host-recent">Recent folders
            <Select aria-label="Recent folders" value="" disabled={busy} onChange={(event) => { if (event.target.value) void browse(event.target.value); }}>
                <option value="">Select a recent workspace</option>
                {host.recentWorkspaces.map((path) => <option key={path} value={path}>{path}</option>)}
            </Select>
        </label>}
        <div className="host-folder-heading"><strong>Folders</strong><div>
            <Button variant="secondary" type="button" disabled={busy || !listing || path !== listing.path} onClick={() => setNewFolder("")}>New folder</Button>
            <Button variant="secondary" type="button" disabled={busy || !listing?.parent} onClick={() => { if (listing?.parent) void browse(listing.parent); }}><ArrowUp size={14} />Parent folder</Button></div></div>
        {newFolder !== null && <form className="host-new-folder" onSubmit={(event) => { event.preventDefault(); void createFolder(); }}>
            <label htmlFor="new-folder-name">New folder name</label><div>
                <Input id="new-folder-name" value={newFolder} disabled={busy} onChange={(event) => setNewFolder(event.target.value)} autoFocus />
                <Button variant="primary" type="submit" disabled={busy || !newFolder.trim()}>Create folder</Button>
                <Button variant="secondary" type="button" disabled={busy} onClick={() => setNewFolder(null)}>Cancel creation</Button>
            </div>
        </form>}
        <div className="host-folder-list" aria-label="Local folders" aria-busy={busy}>
            {busy ? <p role="status">Reading folders...</p> : listing?.directories.length
                ? listing.directories.map((entry) => <Button variant="item" key={entry.path} type="button" onClick={() => void browse(entry.path)}><FolderOpen size={16} />{entry.name}</Button>)
                : <p>No subfolders. You can open this folder or enter another path.</p>}
        </div>
        {listing?.truncated && <p role="status">Showing the first 500 folders. Enter a full path to reach another folder.</p>}
        {error && <p className="host-error" role="alert">{error}</p>}
        <div className="dialog-actions"><Button onClick={close}>Cancel</Button>
            <Button variant="primary" disabled={busy || !path.trim()} onClick={() => open(path)}>Open workspace</Button></div>
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
                <Button variant="secondary" type="button" disabled={pending || disabled} onClick={cancel} autoFocus>Deny</Button>
                <Button variant="primary" type="button" className="host-primary" disabled={pending || disabled}
                    onClick={() => void send({ type: "permission-response", id: request.id, approved: true })}>Allow once</Button>
                {request.canAllowAllForSession && <Button variant="secondary" type="button" disabled={pending || disabled}
                    onClick={() => void send({ type: "permission-response", id: request.id, approved: true, allowAllForSession: true })}>Allow all for this session</Button>}
            </div>
        </> : <form onSubmit={(event) => { event.preventDefault(); void send({ type: "question-response", id: request.id, answer }); }}>
            <p>{request.question}</p>
            {request.choices?.length ? <label>Choose an answer<Select aria-label="Choose an answer" value={request.choices.includes(answer) ? answer : ""}
                onChange={(event) => setAnswer(event.target.value)}><option value="">Select an answer</option>
                {request.choices.map((choice) => <option key={choice}>{choice}</option>)}</Select></label> : null}
            {request.allowFreeform !== false && <label>Written answer<Textarea aria-label="Written answer" value={answer} onChange={(event) => setAnswer(event.target.value)} /></label>}
            <div className="dialog-actions"><Button variant="secondary" type="button" disabled={pending || disabled} onClick={cancel}>Cancel</Button>
                <Button variant="primary" type="submit" className="host-primary" disabled={pending || disabled || !answer.trim()}>Send answer</Button></div>
        </form>}
        {error && <p className="host-error" role="alert">{error}</p>}
        {disabled && <p className="host-error" role="status">Waiting for the host connection before accepting a response.</p>}
    </Modal>;
}

function NoticeBanner({ message, dismiss }: { message: string; dismiss?: () => Promise<void> | void }) {
    const [pending, setPending] = useState(false);
    const button = useRef<HTMLButtonElement>(null);
    const restoreFocus = useRef(false);
    const dismissible = Boolean(dismiss);
    useLayoutEffect(() => {
        const control = button.current;
        return () => {
            if (control && (document.activeElement === control || restoreFocus.current && document.activeElement === document.body)) {
                document.querySelector<HTMLElement>(".host-main")?.focus({ preventScroll: true });
            }
        };
    }, [dismissible]);
    useLayoutEffect(() => {
        if (!pending && restoreFocus.current && document.activeElement === document.body) button.current?.focus({ preventScroll: true });
    }, [pending]);
    return <div className="host-banner host-error host-notification">
        <span role="alert" tabIndex={0}>{message}</span>
        {dismiss && <Button variant="secondary" ref={button} type="button" disabled={pending} title="Dismiss this notification. Its details remain in Diagnostics."
            onClick={async () => {
                restoreFocus.current = document.activeElement === button.current;
                setPending(true);
                try { await dismiss(); } finally { setPending(false); }
            }}>Dismiss<span className="visually-hidden"> notification</span></Button>}
    </div>;
}

interface LocalError { id: string; message: string; generation: string; dismissible: boolean }

export function BrowserApp({ store, connect = true }: { store: BrowserStore; connect?: boolean }) {
    const { host, connected, error: connectionError } = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const [dialog, setDialog] = useState<"workspace" | "diagnostics" | "about" | null>(null);
    const [confirmation, setConfirmation] = useState<{ title: string; detail: string; command: HostCommand } | null>(null);
    const [diagnostics, setDiagnostics] = useState("");
    const [localError, setLocalError] = useState<LocalError | null>(null);
    const [busy, setBusy] = useState(false);
    const [reload, setReload] = useState(0);
    const generation = host?.generation;
    const reportError = useCallback((message: string, dismissible = true) => {
        if (!generation || store.getSnapshot().host?.generation !== generation) return;
        store.recordError(generation, message);
        setLocalError({ id: crypto.randomUUID(), message, generation, dismissible });
    }, [store, generation]);
    const error = localError?.generation === generation ? localError : null;
    const application = useEmbeddedHeader(host?.canvasUrl, generation, reload, reportError);
    useEffect(() => connect ? store.connect() : undefined, [store, connect]);
    useEffect(() => { setLocalError(null); setConfirmation(null); setDialog(null); }, [generation]);
    useEffect(() => {
        if (dialog !== "diagnostics" || !connected) return;
        let active = true;
        let pending = false;
        const timer = setInterval(() => {
            if (pending) return;
            pending = true;
            void store.diagnostics().then((text) => { if (active) setDiagnostics(text); },
                (error: unknown) => { if (active) reportError(error instanceof Error ? error.message : String(error)); })
                .finally(() => { pending = false; });
        }, 2000);
        return () => { active = false; clearInterval(timer); };
    }, [dialog, connected, store, reportError]);
    const active = connected && host && !["stopping", "stopped"].includes(host.phase);
    const run = async (command: HostCommand) => {
        setBusy(true);
        try { await store.command(command); if (store.getSnapshot().host?.generation === generation) setConfirmation(null); }
        catch (error) { reportError(error instanceof Error ? error.message : String(error)); }
        finally { setBusy(false); }
    };
    const showDiagnostics = async () => {
        setDialog("diagnostics"); setDiagnostics("Loading diagnostics...");
        try {
            const text = await store.diagnostics();
            if (store.getSnapshot().host?.generation === generation) setDiagnostics(text);
        }
        catch (error) {
            if (store.getSnapshot().host?.generation === generation) setDiagnostics("");
            reportError(error instanceof Error ? error.message : String(error));
        }
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
    const permissionsDisabled = application.header?.permissionScope !== "main" || !active || busy || !host?.workspace || host.phase === "error";
    const permissionsTitle = application.header?.permissionScope !== "main" ? "Tool permission controls are unavailable until application ownership is verified."
        : `Upstream tool permissions: ${host?.permissionMode === "allow-all" ? "Allow all for this session" : "Ask each time"}`;
    const displayedVersion = application.header?.version || host?.version;
    const applicationStatus = application.header?.status;
    const notice = host?.notice;
    return <div className="host-shell">
        <header className="host-header">
            <div className="host-brand"><Brand /></div>
            <span className="host-workspace" title={host?.workspace || ""}>{host?.workspace || "Local browser workspace"}</span>
            {application.header?.lifecycle && <span className="host-lifecycle" aria-label="Development lifecycle" title={application.header.lifecycle}>{application.header.lifecycle}</span>}
            <span className="host-version" title={application.header ? "Tandem application version" : "Tandem host version"}>{displayedVersion ? `v${displayedVersion}` : ""}</span>
            <nav className="host-header-actions" aria-label="Workspace controls">
                <IconButton variant="ghost" type="button" className="host-icon-button" aria-label="Open folder" title="Open folder"
                    disabled={!active || busy} onClick={() => setDialog("workspace")}><FolderOpen size={16} aria-hidden="true" /></IconButton>
                <IconButton variant="ghost" type="button" className="host-icon-button" aria-label="Reload page" title="Reload page"
                    disabled={!host?.canvasUrl} onClick={() => setReload((value) => value + 1)}><RefreshCw size={16} aria-hidden="true" /></IconButton>
                {!privateDevelopment && <label className="host-permissions" title={permissionsTitle} data-mode={host?.permissionMode || "ask"} data-disabled={permissionsDisabled}>
                    {host?.permissionMode === "allow-all" ? <ShieldAlert size={16} aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}
                    <Select aria-label="Tool permissions" title={permissionsTitle} value={host?.permissionMode || "ask"}
                        disabled={permissionsDisabled}
                        onChange={(event) => {
                            if (!host) return;
                            if (event.target.value === "ask") void run({ type: "set-permission-mode", mode: "ask", generation: host.generation });
                            else setConfirmation({ title: "Allow all tool actions for this session?",
                                detail: "Copilot may run commands, change files and access the network without further tool confirmation. Only enable this for trusted workspaces. This is not saved: restarting or switching the workspace restores Ask each time. Managed-policy and sandbox-bypass consent remain separate.",
                                command: { type: "set-permission-mode", mode: "allow-all", generation: host.generation } });
                        }}>
                        <option value="ask">Ask each time</option><option value="allow-all">Allow all for this session</option>
                    </Select>
                </label>}
                <IconButton variant="ghost" type="button" className="host-icon-button" aria-label="Diagnostics" title="Diagnostics"
                    disabled={!connected} onClick={() => void showDiagnostics()}><ScrollText size={16} aria-hidden="true" /></IconButton>
                <IconButton variant="ghost" type="button" className="host-icon-button" aria-label="About" title="About"
                    onClick={() => setDialog("about")}><Info size={16} aria-hidden="true" /></IconButton>
                <IconButton variant="ghost" type="button" className="host-icon-button" aria-label="Stop" title="Stop Tandem"
                    disabled={!connected || busy || host?.phase === "stopping"} onClick={() => {
                        if (host) setConfirmation({ title: "Stop Tandem?", detail: "This stops the local backend and its active work. Closing a tab alone does not stop it. Saved workspace state is kept.",
                            command: { type: "stop", generation: host.generation } });
                    }}><Square size={14} aria-hidden="true" /></IconButton>
            </nav>
        </header>
        {connectionError && <div className="host-banner host-error" role="alert">{connectionError}</div>}
        {host?.error && <div className="host-banner host-error" role="alert">{host.error}</div>}
        {error && <NoticeBanner key={error.id} message={error.message}
            dismiss={error.dismissible ? () => setLocalError(current => current?.id === error.id && current.generation === error.generation ? null : current) : undefined} />}
        {host && notice && <NoticeBanner key={`${host.generation}:${notice.id}`} message={notice.message}
            dismiss={connected && host.phase === "ready" ? async () => {
                try { await store.command({ type: "dismiss-notice", id: notice.id, generation: host.generation }); }
                catch (error) { reportError(error instanceof Error ? error.message : String(error)); }
            } : undefined} />}
        {application.header?.messages.map((message) => <div key={message.id} className={`host-banner${message.error ? " host-error" : ""}`}
            role={message.error ? "alert" : "status"}>{message.text}</div>)}
        {host?.warning && <div className="host-banner host-warning" role="status">{host.warning}</div>}
        {request && !showRequest && <Button variant="secondary" className="host-pending" type="button" onClick={() => { setDialog(null); setConfirmation(null); }}>{host.requests.length} backend request(s) need your response</Button>}
        <main className="host-main" tabIndex={0} aria-label="Tandem workspace viewport">
            {host?.canvasUrl ? <iframe key={`${host.generation}:${host.canvasUrl}:${reload}`} ref={application.frame} id="tandem-application" title="Tandem workspace"
                src={application.src} onLoad={application.onLoad} referrerPolicy="no-referrer"
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox" />
                : <section className="host-notice" aria-label="Workspace status">
                    {host?.phase === "starting" && <LoaderCircle className="spin" size={28} />}
                    <h1>{host?.phase === "stopped" ? "Tandem stopped" : host?.phase === "error" ? "Workspace unavailable"
                        : host?.phase === "starting" ? "Starting your workspace" : host?.phase === "stopping" ? "Stopping Tandem" : "Welcome to Tandem"}</h1>
                    <p>{host?.status || "Connecting to the local host..."}</p>
                    {!host?.error && <p className="host-muted">Your workspace stays on this computer. Copilot runs independently of the Copilot desktop app.</p>}
                    {host && ["idle", "error"].includes(host.phase) && <div className="host-notice-actions">
                        <Button variant="secondary" type="button" disabled={!active || busy} onClick={() => setDialog("workspace")}><FolderOpen size={16} />Open folder</Button>
                        {host.workspace && <Button variant="primary" type="button" className="host-primary" disabled={!active || busy}
                            onClick={() => void run({ type: "retry", generation: host.generation })}><RefreshCw size={16} />Retry</Button>}
                    </div>}
                </section>}
        </main>
        <footer className="host-status">
            <span className="host-status-state" role="status" title={host?.status || "Connecting..."}>{host?.status || "Connecting..."}</span>
            {applicationStatus && <div className="host-application-status" data-status={applicationStatus.error ? "error" : "idle"}>
                <span role="status" title={applicationStatus.text}>{applicationStatus.text}</span>
                {applicationStatus.action && <IconButton variant="ghost" type="button" className="host-status-action" aria-label="Go to action"
                    title={`Go to action: ${applicationStatus.action}`} onClick={application.showNextAction}><ArrowRight size={13} aria-hidden="true" /></IconButton>}
            </div>}
            <span className="host-status-hint">Tab close keeps running | Stop or Ctrl+C to exit</span>
        </footer>
        {dialog === "workspace" && host && <WorkspacePicker store={store} host={host} close={() => setDialog(null)} open={open} />}
        {dialog === "diagnostics" && <Modal title="Diagnostics" description="Redacted host and backend messages. Workspace logs are in .tandem\desktop\browser.log." close={() => setDialog(null)} wide>
            <pre className="host-log" tabIndex={0}>{diagnostics || "No diagnostic messages."}</pre>
            {error && <p className="host-error" role="alert">{error.message}</p>}
            <div className="dialog-actions"><Button variant="secondary" type="button" disabled={!connected} onClick={() => void showDiagnostics()}>Refresh</Button><Button variant="secondary" type="button" onClick={() => setDialog(null)}>Close</Button></div>
        </Modal>}
        {dialog === "about" && <Modal title={`Tandem ${host?.version || ""}`} description="Standalone Node.js browser host" close={() => setDialog(null)}>
            <p>The same Tandem workflow and artifacts, without .NET or WebView2. Copilot authentication and network access are required for AI operations.</p>
            <p>Only open workspaces and tools you trust. Tool permissions start in Ask each time.</p>
            <p>Closing a tab leaves the backend running. Use Stop here or Ctrl+C in the terminal to stop it.</p>
            <div className="dialog-actions"><Button variant="secondary" type="button" onClick={() => setDialog(null)}>Close</Button></div>
        </Modal>}
        {confirmation && <Modal title={confirmation.title} description={confirmation.detail} close={() => { if (!busy) setConfirmation(null); }}>
            <div className="dialog-actions"><Button variant="secondary" type="button" disabled={busy} onClick={() => setConfirmation(null)} autoFocus>Cancel</Button>
                <Button variant="primary" type="button" className="host-primary" disabled={busy || !connected} onClick={() => void run(confirmation.command)}>Confirm</Button></div>
            {error && <p className="host-error" role="alert">{error.message}</p>}
        </Modal>}
        {showRequest && host && <RequestDialog key={`${host.generation}:${request.id}`} request={request} remaining={host.requests.length}
            disabled={!connected} reply={(command) => store.command({ ...command, generation: host.generation })} />}
    </div>;
}
