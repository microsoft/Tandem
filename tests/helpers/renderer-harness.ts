import { readFile } from "node:fs/promises";
import { transform } from "esbuild";
import { runInNewContext } from "node:vm";

type Listener = { callback: (event: any) => unknown; capture: boolean };
const dataName = (name: string) => name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase());

export class Element {
    children: Element[] = [];
    parentElement: Element | null = null;
    dataset: Record<string, string> = {};
    attributes = new Map<string, string>();
    listeners = new Map<string, Listener[]>();
    style: Record<string, any> = { setProperty(name: string, value: string) { this[name] = value; } };
    id = ""; className = ""; name = ""; type = ""; value = "";
    hidden = false; disabled = false; checked = false; open = false;
    tabIndex = -1; scrollTop = 0; scrollLeft = 0; clientWidth = 500;
    selectionStart = 0; selectionEnd = 0; title = "";
    private text = "";
    constructor(readonly tagName: string, readonly ownerDocument: Document) {}
    get childElementCount() { return this.children.length; }
    get isConnected(): boolean { return this === this.ownerDocument || Boolean(this.parentElement?.isConnected); }
    get previousElementSibling() {
        const siblings = this.parentElement?.children || [];
        return siblings[siblings.indexOf(this) - 1] || null;
    }
    get textContent(): string { return this.text + this.children.map((child) => child.textContent).join(""); }
    set textContent(value: string) { this.replaceChildren(); this.text = String(value ?? ""); }
    get innerHTML() { return this.textContent; }
    set innerHTML(html: string) { this.replaceChildren(); parseHtml(html, this); }
    get selectedIndex() { return this.children.findIndex((child) => child.value === this.value); }
    set selectedIndex(index: number) { this.value = this.children[index]?.value || ""; }
    get classList() {
        const self = this;
        return {
            contains(value: string) { return self.className.split(/\s+/).includes(value); },
            add(...values: string[]) { self.className = [...new Set([...self.className.split(/\s+/).filter(Boolean), ...values])].join(" "); },
            remove(...values: string[]) { self.className = self.className.split(/\s+/).filter((value) => !values.includes(value)).join(" "); },
            toggle(value: string, force?: boolean) {
                const enabled = force ?? !this.contains(value);
                if (enabled) this.add(value); else this.remove(value);
                return enabled;
            },
        };
    }
    append(...nodes: Element[]) {
        for (const node of nodes) {
            if (node.parentElement) node.parentElement.children = node.parentElement.children.filter((child) => child !== node);
            node.parentElement = this;
            this.children.push(node);
        }
    }
    replaceChildren(...nodes: Element[]) {
        for (const child of this.children) {
            if (child.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body;
            child.parentElement = null;
        }
        this.children = []; this.text = "";
        this.append(...nodes);
    }
    before(node: Element) {
        const siblings = this.parentElement!.children;
        siblings.splice(siblings.indexOf(this), 0, node);
        node.parentElement = this.parentElement;
    }
    contains(node: Element | null): boolean {
        return node === this || this.children.some((child) => child.contains(node));
    }
    setAttribute(name: string, value: string) {
        this.attributes.set(name, String(value));
        if (name.startsWith("data-")) this.dataset[dataName(name)] = String(value);
        else if (name === "class") this.className = value;
        else if (name === "tabindex") this.tabIndex = Number(value);
        else if (["id", "name", "type", "value", "title"].includes(name)) (this as any)[name] = value;
        else if (["hidden", "disabled", "checked", "open"].includes(name)) (this as any)[name] = true;
    }
    getAttribute(name: string): string | null {
        if (name.startsWith("data-")) return this.dataset[dataName(name)] ?? null;
        if (name === "class") return this.className || null;
        if (["hidden", "disabled", "checked", "open"].includes(name)) return (this as any)[name] ? "" : null;
        if (["id", "name", "type", "value", "title"].includes(name)) return (this as any)[name] || null;
        return this.attributes.get(name) ?? null;
    }
    removeAttribute(name: string) {
        this.attributes.delete(name);
        if (name.startsWith("data-")) delete this.dataset[dataName(name)];
        else if (name === "title") this.title = "";
    }
    matches(selector: string): boolean {
        let source = selector.trim();
        const not = source.match(/:not\(([^)]+)\)/);
        if (not) { if (this.matches(not[1])) return false; source = source.replace(not[0], ""); }
        if (source.includes(":checked")) { if (!this.checked) return false; source = source.replace(":checked", ""); }
        const attributes = [...source.matchAll(/\[([^\]=\s]+)(?:=["']?([^\]"']*)["']?)?\]/g)];
        for (const [, name, value] of attributes) {
            const actual = this.getAttribute(name);
            if (actual === null || (value !== undefined && actual !== value)) return false;
        }
        source = source.replace(/\[[^\]]+\]/g, "");
        const id = source.match(/#([\w-]+)/)?.[1];
        if (id && this.id !== id) return false;
        for (const match of source.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(match[1])) return false;
        const tag = source.match(/^[\w-]+/)?.[0];
        return !tag || this.tagName === tag;
    }
    querySelectorAll(selector: string): Element[] {
        const selectors = selector.split(",");
        return this.children.flatMap((child) => [
            ...(selectors.some((part) => child.matches(part)) ? [child] : []),
            ...child.querySelectorAll(selector),
        ]);
    }
    querySelector(selector: string) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector: string): Element | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    addEventListener(name: string, callback: Listener["callback"], capture = false) {
        this.listeners.set(name, [...this.listeners.get(name) || [], { callback, capture }]);
    }
    async emit(name: string, details: Record<string, unknown> = {}) {
        const event = { target: this, preventDefault() {}, ...details };
        const path: Element[] = [];
        for (let node: Element | null = this; node; node = node.parentElement) path.push(node);
        for (const node of [...path].reverse()) {
            for (const listener of node.listeners.get(name) || []) if (listener.capture) await listener.callback(event);
        }
        for (const node of path) {
            const handler = (node as any)["on" + name];
            if (handler) await handler(event);
            for (const listener of node.listeners.get(name) || []) if (!listener.capture) await listener.callback(event);
        }
    }
    focus() { this.ownerDocument.activeElement = this; }
    setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; }
    getBoundingClientRect() { return { width: Number.parseFloat(this.style.width) || this.clientWidth, left: 0 }; }
    hasPointerCapture() { return false; }
    setPointerCapture() {}
    releasePointerCapture() {}
}

class Document extends Element {
    documentElement!: Element;
    body!: Element;
    activeElement!: Element;
    constructor() {
        super("document", undefined as any);
        Object.defineProperty(this, "ownerDocument", { value: this });
    }
    createElement(tag: string) { return new Element(tag, this); }
    getElementById(id: string) { return this.querySelector("#" + id); }
}

function parseHtml(html: string, root: Element) {
    const stack = [root];
    const voidTags = new Set(["meta", "input", "link", "br", "hr", "img"]);
    for (const token of html.match(/<[^>]+>|[^<]+/g) || []) {
        if (token.startsWith("<!") || !token.startsWith("<")) continue;
        if (token.startsWith("</")) { if (stack.length > 1) stack.pop(); continue; }
        const name = token.match(/^<([\w-]+)/)?.[1];
        if (!name) continue;
        const element = root.ownerDocument.createElement(name);
        for (const [, key, value] of token.slice(name.length + 1).matchAll(/([:\w-]+)(?:="([^"]*)")?/g)) {
            element.setAttribute(key, value ?? "");
        }
        stack.at(-1)!.append(element);
        if (name === "option" && element.parentElement?.tagName === "select" && !element.parentElement.value) {
            element.parentElement.value = element.value;
        }
        if (!voidTags.has(name) && !token.endsWith("/>")) stack.push(element);
    }
}

let compiled: Promise<string> | undefined;
async function compile() {
    const source = (await readFile(new URL("../../src/renderer/client.ts", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
    const end = source.indexOf("\nrefreshSharedState()\n");
    if (end < 0) throw new Error("Renderer initialization boundary not found");
    const testApi = `
globalThis.api = {
  elements, render, renderIfChanged, refreshSharedState, postJson, browseStage,
  renderDesignTree, renderPlanDag, renderMermaidArtifact, renderQuestion, renderPrototypeReview,
  setDiagramScale, setDiagramFit, diagramViews, formDrafts, hasActiveJobs,
  current: () => currentState,
  pending: () => submitting,
  setPending: value => { submitting = value; },
  selectDecision: id => { selectedDecisionId = id; followingActiveDecision = false; },
  setMermaid: loader => { loadMermaid = loader; },
};`;
    return (await transform(source.slice(0, end) + testApi, {
        loader: "ts", format: "cjs", target: "es2022", logLevel: "silent",
    })).code;
}

export async function rendererHarness() {
    const document = new Document();
    const html = (await readFile(new URL("../../src/renderer/index.html", import.meta.url), "utf8"))
        .replaceAll("__TANDEM_VERSION__", "0.0.0-test");
    parseHtml(html, document);
    document.documentElement = document.querySelector("html")!;
    document.body = document.querySelector("body")!;
    document.activeElement = document.body;
    const requests: { path: string; body: any }[] = [];
    const timers: (() => void)[] = [];
    const confirmations: string[] = [];
    let confirm = true;
    let narrowViewport = false;
    let handler: (path: string, options: any) => Promise<any> = async () => { throw new Error("Network disabled in renderer tests"); };
    const context: any = {
        module: { exports: {} }, exports: {}, document, console, Error,
        HTMLDetailsElement: Element,
        AbortSignal: { timeout: () => undefined },
        requestAnimationFrame() {},
        window: {
            matchMedia: (query: string) => ({ matches: query === "(max-width: 760px)" && narrowViewport }),
            addEventListener() {}, clearInterval() {},
            setInterval(callback: () => void) { timers.push(callback); return timers.length; },
            confirm(message: string) { confirmations.push(message); return confirm; },
        },
        fetch(path: string, options: any = {}) {
            requests.push({ path, body: options.body ? JSON.parse(options.body) : null });
            return handler(path, options);
        },
    };
    runInNewContext(await (compiled ??= compile()), context);
    return {
        api: context.api as any, document, requests, timers, confirmations,
        setFetch(value: typeof handler) { handler = value; },
        setConfirm(value: boolean) { confirm = value; },
        setNarrowViewport(value: boolean) { narrowViewport = value; },
        flush: () => new Promise<void>((resolve) => setImmediate(resolve)),
    };
}

export function state(stage = "requirements", revision = 1): any {
    const stages = ["prepare", "requirements", "prototype", "design", "plan", "implement", "test"];
    return {
        version: 1, prototypeId: "fixture", revision, updatedAt: `2026-09-06T00:00:${String(revision).padStart(2, "0")}Z`,
        generation: "fixture-generation", jobOwner: null,
        lifecycle: { currentStage: stage, completedStages: stages.slice(0, stages.indexOf(stage)), outputs: [], skippedStages: [], history: [] },
        provider: { canSubmitAnswers: true, extensionId: "fixture", canReload: false },
        preparation: { status: stage === "prepare" ? "not-started" : "ready", workItems: [], messages: [], checks: [], sources: [], suggestedUsages: [], processing: null },
        prototypeApproach: { mode: stage === "prepare" ? "undecided" : "build", reason: "Fixture prototype approach" },
        requirements: { substage: "usage", usageItems: [], suggestions: [] },
        decisionGraph: { nodes: [] }, artifacts: [], previewStatus: "waiting", previewUrl: null,
        prototypeReview: { revisions: [], question: null },
        planning: { status: "idle", workItems: [], agents: [], waves: [], maxAgents: 4 },
        implementation: { status: "idle", workItems: [], agents: [] },
        testing: { status: "idle", scenarios: [], agents: [] },
        designReview: { threads: [] }, testDesignReview: { threads: [], scenarios: [] },
        design: { substage: "product" },
    };
}

export function decision(id: string, status = "active") {
    return {
        id, title: id, status, answer: status === "answered" ? "Previous answer" : null, dependencies: [],
        question: { id, text: id, choices: ["A", "B"], recommended: "A", allowFreeText: true },
    };
}

export function response(body: any, status = 200) {
    return { ok: status < 400, status, json: async () => body };
}
