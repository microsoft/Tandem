import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CaptureUpdateAction, Excalidraw, MainMenu, exportToBlob, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { canonicalScene, editorOperationsBetween, fingerprint, latestSealedEdit } from "../shared/scene.mjs";
import "@excalidraw/excalidraw/index.css";
import "./style.css";

type Scene = ReturnType<typeof canonicalScene>;
type Topic = { topicId: string; name: string };
type State = { topicId: string; topicName: string; versionId: string; scene: Scene; latestSealedVersionId: string; hasUnsealedChanges: boolean; sealedCount: number };
type Result = State & { error?: string; sealed?: boolean };
type RenderResult = { topicId?: string; versionId?: string; dataURL?: string; width?: number; height?: number; error?: string };
declare global { interface Window { __whiteboardRender?: RenderResult } }
function parseState(value: unknown): State {
  if (!value || typeof value !== "object" || !("versionId" in value) || typeof value.versionId !== "string" ||
      !("topicId" in value) || typeof value.topicId !== "string" || !("topicName" in value) || typeof value.topicName !== "string" ||
      !("scene" in value) || !("latestSealedVersionId" in value) || typeof value.latestSealedVersionId !== "string" ||
      !("sealedCount" in value) || typeof value.sealedCount !== "number" || !("hasUnsealedChanges" in value)) throw new Error("Invalid working-state response.");
  return { topicId: value.topicId, topicName: value.topicName, versionId: value.versionId, scene: canonicalScene(value.scene), latestSealedVersionId: value.latestSealedVersionId,
    sealedCount: value.sealedCount, hasUnsealedChanges: Boolean(value.hasUnsealedChanges) };
}
function parseTopics(value: unknown): Topic[] {
  if (!value || typeof value !== "object" || !("topics" in value) || !Array.isArray(value.topics)) throw new Error("Invalid topic list.");
  return value.topics.map((topic: unknown) => {
    if (!topic || typeof topic !== "object" || !("topicId" in topic) || typeof topic.topicId !== "string" ||
        !("name" in topic) || typeof topic.name !== "string") throw new Error("Invalid topic identity.");
    return { topicId: topic.topicId, name: topic.name };
  });
}
const nativeElements = (scene: Scene) => {
  // Excalidraw restoration treats zero as a missing stroke width; zero is explicit in our API.
  const elements = scene.elements as readonly ExcalidrawElement[];
  const zeroStroke = new Set(elements.filter((element) => element.strokeWidth === 0).map((element) => element.id));
  return restoreElements(elements, null, { repairBindings: true })
    .map((element) => zeroStroke.has(element.id) ? { ...element, strokeWidth: 0 } : element);
};
const editorScene = (scene: Scene) => canonicalScene({ elements: nativeElements(scene) });

function Whiteboard() {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const boardRef = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const topicId = useRef("");
  const [creating, setCreating] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [message, setMessage] = useState("Connecting to the memory-only board...");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [resetting, setResetting] = useState(false);
  const base = useRef<State | null>(null), local = useRef<Scene | null>(null), latest = useRef<State | null>(null);
  // Compare user edits with the installed native projection, not its pre-restoration path origins.
  const displayedBase = useRef<Scene | null>(null);
  const instance = useRef(""), inFlight = useRef(false), installing = useRef(false), blocked = useRef(false);
  const stream = useRef<EventSource | null>(null);
  const resubscribe = useRef<() => void>(() => {});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const captureApi = useCallback((value: ExcalidrawImperativeAPI) => { apiRef.current = value; setApi(value); }, []);
  const install = useCallback((next: State) => {
    if (next.topicId !== topicId.current) return;
    const changingTopic = !base.current || base.current.topicId !== next.topicId;
    const elements = nativeElements(next.scene);
    base.current = next; displayedBase.current = canonicalScene({ elements }); local.current = displayedBase.current; setState(next);
    if (!apiRef.current) return;
    installing.current = true;
    const app = apiRef.current.getAppState();
    apiRef.current.updateScene({ elements, appState: {
      isLoading: false,
      selectedElementIds: changingTopic ? {} : app.selectedElementIds,
      selectedGroupIds: changingTopic ? {} : app.selectedGroupIds,
      editingGroupId: changingTopic ? null : app.editingGroupId,
      scrollX: changingTopic ? 0 : app.scrollX, scrollY: changingTopic ? 0 : app.scrollY,
      zoom: changingTopic ? { value: 1 as AppState["zoom"]["value"] } : app.zoom,
    }, captureUpdate: CaptureUpdateAction.NEVER });
    requestAnimationFrame(() => { installing.current = false; });
  }, []);

  const post = useCallback(async (operation: "read" | "edit" | "seal", input: object, targetTopicId: string) => {
    const response = await fetch(`/${operation}`, { method: "POST",
      headers: { "Content-Type": "application/json", "x-whiteboard-instance": instance.current }, body: JSON.stringify({ ...input, topicId: targetTopicId }) });
    const result = await response.json() as Result;
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.error ?? "Operation failed"}`);
    return result;
  }, []);

  const flush = useCallback(async () => {
    if (inFlight.current || blocked.current || !base.current || !displayedBase.current || !local.current) return;
    const sent = local.current, acknowledged = base.current;
    const operations = editorOperationsBetween(displayedBase.current, sent);
    if (!operations.length) { setPending(false); return; }
    inFlight.current = true; setPending(true);
    stream.current?.close(); stream.current = null;
    try {
      const result = parseState(await post("edit", { expectedVersionId: acknowledged.versionId, operations }, acknowledged.topicId));
      base.current = result; displayedBase.current = editorScene(result.scene); setState(result); setError(null);
      if (fingerprint(local.current) === fingerprint(sent)) {
        local.current = displayedBase.current; setPending(false);
      }
    } catch (failure) {
      blocked.current = true; setConflict(true); setPending(false);
      setError(`${String(failure)}. Local edits remain in this tab; download them before reloading working state.`);
    } finally {
      inFlight.current = false;
      resubscribe.current();
      if (!blocked.current && displayedBase.current && local.current && fingerprint(local.current) !== fingerprint(displayedBase.current)) {
        timer.current = setTimeout(() => void flush(), 50);
      }
    }
  }, [install, post]);

  useEffect(() => {
    if (!api) return;
    let disposed = false;
    void fetch("/health").then(async (response) => {
      const health = await response.json();
      if (health.service !== "optional-whiteboard/v1" || typeof health.defaultTopicId !== "string") throw new Error("Wrong whiteboard service or missing topic support.");
      instance.current = health.instanceId;
      topicId.current = health.defaultTopicId;
      if (disposed) return;
      const subscribe = () => {
      stream.current?.close();
      const subscribedTopicId = topicId.current;
      const events = new EventSource(`/events?instanceId=${encodeURIComponent(instance.current)}&topicId=${encodeURIComponent(subscribedTopicId)}`);
      stream.current = events;
      events.addEventListener("topics", (event) => {
        if (stream.current !== events) return;
        try { setTopics(parseTopics(JSON.parse((event as MessageEvent<string>).data))); }
        catch (failure) { setError(String(failure)); }
      });
      events.onmessage = ({ data }) => {
        if (stream.current !== events || subscribedTopicId !== topicId.current) return;
        try {
          const incoming = parseState(JSON.parse(data));
          if (incoming.topicId !== subscribedTopicId) throw new Error("Stream returned a different topic; current content was not replaced.");
          latest.current = incoming;
          if (!base.current) {
            install(incoming); apiRef.current?.history.clear();
            setMessage(`Topic: ${incoming.topicName}. RAM only; switching keeps drafts and seals, but restart loses them.`);
            return;
          }
          if (inFlight.current || displayedBase.current && local.current && fingerprint(local.current) !== fingerprint(displayedBase.current)) return;
          if (blocked.current) return;
          if (incoming.versionId !== base.current.versionId) install(incoming);
          else { base.current = incoming; setState(incoming); }
        } catch (failure) { setError(String(failure)); }
      };
      events.onerror = () => {
        if (stream.current === events) setError("Connection unavailable. The board may have restarted; working state and seals are memory-only. Local tab content is not automatically discarded.");
      };
      };
      resubscribe.current = subscribe;
      subscribe();
    }).catch((failure) => setError(String(failure)));
    return () => { disposed = true; stream.current?.close(); stream.current = null; resubscribe.current = () => {}; clearTimeout(timer.current); };
  }, [api, install]);

  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (blocked.current || inFlight.current || displayedBase.current && local.current && fingerprint(displayedBase.current) !== fingerprint(local.current)) {
        event.preventDefault(); event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, []);

  const changed = useCallback((elements: readonly ExcalidrawElement[], appState: AppState) => {
    setInteracting(Boolean(appState.editingTextElement || appState.multiElement || appState.isResizing || appState.isRotating));
    if (installing.current || !base.current || !displayedBase.current) return;
    try {
      const scene = canonicalScene({ elements: elements.filter((element) => !element.isDeleted) });
      local.current = scene;
      if (blocked.current) { setPending(false); return; }
      if (fingerprint(scene) === fingerprint(displayedBase.current) && !inFlight.current) {
        clearTimeout(timer.current); setPending(false); return;
      }
      setPending(true); clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 60);
    } catch (failure) {
      blocked.current = true; setConflict(true); setPending(false); setError(`${String(failure)}. Unsupported local content was not submitted or discarded.`);
    }
  }, [flush]);
  function downloadLocal() {
    const elements = apiRef.current?.getSceneElements() ?? [];
    const blob = new Blob([JSON.stringify({ type: "excalidraw", version: 2, elements, files: {} })], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = "whiteboard-local-copy.excalidraw"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  async function seal() {
    if (!base.current || pending || inFlight.current || blocked.current) return;
    const inspected = base.current;
    inFlight.current = true; setPending(true);
    stream.current?.close(); stream.current = null;
    try {
      const result = await post("seal", { expectedVersionId: inspected.versionId }, inspected.topicId);
      setMessage(`Sealed ${result.versionId}. The board remains editable; this is not approval.`);
      const sealed = { ...inspected, latestSealedVersionId: result.versionId, hasUnsealedChanges: false };
      base.current = sealed; setState(sealed);
      setError(null);
    } catch (failure) { setError(String(failure)); }
    finally {
      inFlight.current = false;
      const dirty = Boolean(displayedBase.current && local.current && fingerprint(displayedBase.current) !== fingerprint(local.current));
      setPending(dirty);
      resubscribe.current();
      if (dirty && !blocked.current) timer.current = setTimeout(() => void flush(), 50);
    }
  }
  async function resetToLatest() {
    if (!base.current || !apiRef.current || pending || inFlight.current || blocked.current) return;
    const inspected = base.current;
    const currentContent = () => canonicalScene({ elements: apiRef.current!.getSceneElements() });
    const inspectedContent = fingerprint(currentContent());
    if (inspectedContent !== fingerprint(displayedBase.current)) {
      setError("Wait for this tab's edits to finish sending before resetting.");
      return;
    }
    inFlight.current = true; setResetting(true); setPending(true); clearTimeout(timer.current);
    stream.current?.close(); stream.current = null;
    let keepLocal = false;
    const unchangedLocalContent = () => {
      try { return fingerprint(currentContent()) === inspectedContent; }
      catch (failure) { keepLocal = true; throw failure; }
    };
    try {
      const sealed = await post("read", { target: "latest" }, inspected.topicId);
      const edit = latestSealedEdit(inspected, sealed);
      if (edit.operations.length && !window.confirm(
        `Discard unsealed changes and restore the latest sealed content (${sealed.versionId})? All sealed versions are kept. This does not seal the restored working board.`,
      )) return;
      if (!unchangedLocalContent()) {
        keepLocal = true;
        throw new Error("Local content changed while resetting. No reset was submitted.");
      }
      const result = parseState(await post("edit", edit, inspected.topicId));
      if (!unchangedLocalContent()) {
        base.current = result; displayedBase.current = editorScene(result.scene); setState(result); keepLocal = true;
        throw new Error("Working content was reset, but newer local edits remain in this tab. Download them before reloading working state.");
      }
      install(result);
      setError(null);
      setMessage(edit.operations.length
        ? `Restored content from ${sealed.versionId}. All seals are kept; the restored working version is unsealed.`
        : "Working content already matches the latest seal. Nothing changed.");
    } catch (failure) {
      if (blocked.current || local.current && fingerprint(local.current) !== inspectedContent) keepLocal = true;
      if (keepLocal) { blocked.current = true; setConflict(true); }
      setError(String(failure));
    } finally {
      inFlight.current = false; setResetting(false);
      const dirty = Boolean(displayedBase.current && local.current && fingerprint(displayedBase.current) !== fingerprint(local.current));
      setPending(dirty && !blocked.current);
      resubscribe.current();
      if (dirty && !blocked.current) timer.current = setTimeout(() => void flush(), 50);
    }
  }
  function fitDiagram() {
    const editor = apiRef.current;
    if (!editor) return;
    const elements = editor.getSceneElements();
    if (!elements.length) { setMessage("The board is empty; there is no diagram to fit."); return; }
    const region = boardRef.current;
    if (!region) return;
    const bounds = region.getBoundingClientRect();
    const toolbar = region.querySelector(".App-toolbar")?.getBoundingClientRect();
    const properties = region.querySelector(".App-menu__left")?.getBoundingClientRect();
    const sidebar = region.querySelector(".sidebar")?.getBoundingClientRect();
    const footer = region.querySelector("footer")?.getBoundingClientRect();
    editor.scrollToContent(elements, {
      fitToViewport: true, viewportZoomFactor: 0.8, animate: false,
      canvasOffsets: {
        top: Math.max(16, (toolbar?.bottom ?? bounds.top) - bounds.top + 16),
        left: Math.max(16, (properties?.right ?? bounds.left) - bounds.left + 16),
        right: Math.max(16, bounds.right - (sidebar?.left ?? bounds.right) + 16),
        bottom: Math.max(16, bounds.bottom - (footer?.top ?? bounds.bottom) + 16),
      },
    });
    setMessage("Fitted this topic's whole diagram, including text and ink. Content and versions are unchanged.");
  }
  function canSwitchTopic() {
    const editor = apiRef.current;
    if (!editor || !base.current || inFlight.current || installing.current || pending || blocked.current) return false;
    const app = editor.getAppState();
    if (app.editingTextElement || app.multiElement || app.isResizing || app.isRotating) {
      setError("Finish the current canvas interaction before changing topics."); return false;
    }
    try {
      if (fingerprint(canonicalScene({ elements: editor.getSceneElements() })) !== fingerprint(displayedBase.current)) {
        setError("Wait for this topic's local edits to finish sending before changing topics."); return false;
      }
    } catch (failure) { setError(String(failure)); return false; }
    return true;
  }
  function selectTopic(nextTopicId: string) {
    if (!topics.some((topic) => topic.topicId === nextTopicId) || nextTopicId === topicId.current || !canSwitchTopic()) return;
    clearTimeout(timer.current);
    stream.current?.close(); stream.current = null;
    topicId.current = nextTopicId;
    base.current = null; displayedBase.current = null; local.current = null; latest.current = null;
    setState(null); setError(null); setPending(false); setInteracting(false);
    apiRef.current?.history.clear();
    resubscribe.current();
  }
  async function createTopic() {
    if (!canSwitchTopic()) return;
    const name = window.prompt("Name the new discussion topic (up to 80 characters):");
    if (name === null) return;
    if (!canSwitchTopic()) return;
    inFlight.current = true; setCreating(true);
    try {
      const response = await fetch("/topics", { method: "POST",
        headers: { "Content-Type": "application/json", "x-whiteboard-instance": instance.current },
        body: JSON.stringify({ name }) });
      const created: unknown = await response.json();
      if (!response.ok) {
        const detail = created && typeof created === "object" && "error" in created ? String(created.error) : "Topic creation failed.";
        throw new Error(detail);
      }
      const [topic] = parseTopics({ topics: [created] });
      setTopics((current) => current.some((existing) => existing.topicId === topic.topicId) ? current : [...current, topic]);
      setError(null); setMessage(`Created "${topic.name}". Select it from Topics; the current drawing stays here.`);
    } catch (failure) { setError(String(failure)); }
    finally {
      inFlight.current = false; setCreating(false);
      resubscribe.current();
      if (!blocked.current && displayedBase.current && local.current && fingerprint(local.current) !== fingerprint(displayedBase.current)) {
        setPending(true); timer.current = setTimeout(() => void flush(), 50);
      }
    }
  }
  return <div className="whiteboard">
    <header><strong>Brainstorm whiteboard</strong><span className="memory">Memory only</span>
      <label className="topic-control">Topic
        <select aria-label="Discussion topic" value={state?.topicId ?? topicId.current} disabled={!state || pending || conflict || creating || interacting}
          onChange={(event) => selectTopic(event.target.value)}>{topics.map((topic) => <option key={topic.topicId} value={topic.topicId}>{topic.name}</option>)}</select>
      </label>
      <button className="secondary" onClick={() => void createTopic()} disabled={!state || pending || conflict || creating || interacting}>New topic</button>
      <span className="version" title={state?.versionId}>Working: {state?.versionId ?? "connecting"}</span>
      <span role="status">{conflict ? "Local conflict" : resetting ? "Resetting..." : pending ? "Sending edits..." : state?.hasUnsealedChanges ? "Unsealed changes" : state ? "Sealed" : "Connecting"}</span>
      <button className="secondary" onClick={fitDiagram} disabled={!state}>Fit diagram</button>
      <button className="secondary" onClick={() => void resetToLatest()} disabled={!state || pending || conflict || creating}>Reset to latest sealed</button>
      <button onClick={() => void seal()} disabled={!state || pending || conflict || creating}>Seal version</button>
    </header>
    <main ref={boardRef}><Excalidraw excalidrawAPI={captureApi} onChange={changed} aiEnabled={false} validateEmbeddable={false}
      theme="light" name="Brainstorm whiteboard" viewModeEnabled={!state} UIOptions={{ tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false, export: false } }}>
      <MainMenu><MainMenu.Item onSelect={downloadLocal}>Download explicit local copy</MainMenu.Item><MainMenu.DefaultItems.ClearCanvas /><MainMenu.DefaultItems.Help /></MainMenu>
    </Excalidraw></main>
    <footer role={error ? "alert" : undefined}>{error ?? message}
      {conflict && <><button onClick={downloadLocal}>Download local edits</button><button onClick={() => {
        if (!window.confirm("Discard this tab's local edits and load the authoritative working board?")) return;
        if (!latest.current) { setError("No current working state is available."); return; }
        blocked.current = false; setConflict(false); setPending(false); setError(null); install(latest.current);
      }}>Reload working state</button></>}
    </footer>
  </div>;
}

async function renderCapture() {
  try {
    const token = new URLSearchParams(location.search).get("token");
    const response = await fetch(`/render-job/${encodeURIComponent(token ?? "")}`);
    if (!response.ok) throw new Error("Captured seal is unavailable.");
    const capture = await response.json() as { topicId: string; versionId: string; scene: Scene };
    const scene = canonicalScene(capture.scene);
    await document.fonts.ready;
    let blob: Blob;
    if (!scene.elements.length) {
      const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas unavailable.");
      context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
      blob = await new Promise<Blob>((done, reject) => canvas.toBlob((value) => value ? done(value) : reject(new Error("Empty PNG failed."))));
    } else blob = await exportToBlob({ elements: nativeElements(scene).filter((element) => !element.isDeleted), files: {},
      appState: { exportBackground: true, viewBackgroundColor: "#ffffff" }, maxWidthOrHeight: 4096, exportPadding: 24 });
    const dataURL = await new Promise<string>((done, reject) => {
      const reader = new FileReader(); reader.onload = () => done(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
    });
    const bitmap = await createImageBitmap(blob);
    window.__whiteboardRender = { topicId: capture.topicId, versionId: capture.versionId, dataURL, width: bitmap.width, height: bitmap.height };
    bitmap.close();
  } catch (failure) { window.__whiteboardRender = { error: String(failure) }; }
}
if (location.pathname === "/render") void renderCapture();
else {
  const root = document.getElementById("root");
  if (!root) throw new Error("Whiteboard root is missing.");
  createRoot(root).render(<Whiteboard />);
}
