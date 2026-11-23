import { readUiDesign, uiDesignReadiness, uiDesignVersion, type UiDesign } from "../ui-design.js";
import { createRenderer, type UiRenderer } from "../vendor/ui-dsl/index.js";
import rendererCss from "../vendor/ui-dsl/styles.js";

const root = document.getElementById("preview")!;
const error = document.getElementById("error")!;

function render(design: UiDesign): void {
    const fragment = document.createElement("section");
    const heading = document.createElement("h1");
    heading.textContent = `UI design - ${uiDesignVersion(design)}`;
    fragment.dataset.version = uiDesignVersion(design);
    const notice = document.createElement("p");
    notice.textContent = "Screen navigation only, not a working app. Discuss revisions and confirmation in chat.";
    const issues = uiDesignReadiness(design);
    const status = document.createElement("p");
    status.id = "status";
    status.textContent = issues.length ? `Not ready for review: ${issues.join(" ")}` : "Inspect every screen before confirming this version in chat.";
    fragment.dataset.complete = String(issues.length === 0);
    const nav = document.createElement("nav");
    nav.setAttribute("aria-label", "Screens");
    const actual = document.createElement("button");
    actual.textContent = "Actual size";
    actual.setAttribute("aria-pressed", "false");
    const views = document.createElement("div");
    const renderers: UiRenderer[] = [];
    const entries: Array<{ button: HTMLButtonElement; panel: HTMLElement; frame: HTMLElement; surface: HTMLElement; width: number; height: number }> = [];
    let selected = design.document.screens[0].id;
    let fitted = true;
    const resize = () => {
        for (const entry of entries) {
            if (entry.panel.hidden) continue;
            // Reserve the frame's one-pixel margins so fit mode does not scroll horizontally.
            const scale = fitted ? Math.min(1, Math.max(1, views.clientWidth - 2) / entry.width) : 1;
            entry.frame.style.width = `${entry.width * scale}px`;
            entry.frame.style.height = `${entry.height * scale}px`;
            entry.surface.style.transform = `scale(${scale})`;
        }
    };
    const select = (id: string) => {
        selected = id;
        entries.forEach((entry, index) => {
            const active = design.document.screens[index].id === id;
            entry.button.setAttribute("aria-pressed", String(active));
            entry.panel.hidden = !active;
        });
        resize();
    };
    try {
        for (const screen of design.document.screens) {
            const button = document.createElement("button");
            button.textContent = screen.title;
            button.dataset.screenId = screen.id;
            button.onclick = () => select(screen.id);
            nav.append(button);
            const panel = document.createElement("article");
            panel.dataset.screenId = screen.id;
            const title = document.createElement("h2");
            title.textContent = `${screen.title} (${screen.width} x ${screen.height})`;
            const notes = document.createElement("p");
            notes.textContent = `${screen.purpose}${screen.notes ? ` - ${screen.notes}` : ""}`;
            const frame = document.createElement("div");
            frame.className = "frame";
            const surface = document.createElement("div");
            surface.className = "surface";
            surface.style.width = `${screen.width}px`;
            surface.style.height = `${screen.height}px`;
            const shadow = surface.attachShadow({ mode: "open" });
            const style = document.createElement("style");
            style.textContent = `${rendererCss}\n.uidl-surface { min-height: 100%; }`;
            const host = document.createElement("div");
            host.style.height = "100%";
            shadow.append(style, host);
            const renderer = createRenderer(host, { mode: "interact", onEvent: event => {
                if (event.type !== "activate") return;
                const edge = design.document.transitions.find(edge =>
                    edge.fromScreenId === screen.id && edge.id === (event.action || event.destination));
                if (edge) select(edge.toScreenId);
            } });
            renderers.push(renderer);
            renderer.render(screen.ui);
            frame.append(surface);
            const links = document.createElement("nav");
            links.setAttribute("aria-label", `${screen.title} preview navigation`);
            for (const edge of design.document.transitions.filter(edge => edge.fromScreenId === screen.id)) {
                const link = document.createElement("button");
                link.textContent = edge.trigger;
                link.title = edge.description;
                link.onclick = () => select(edge.toScreenId);
                links.append(link);
            }
            panel.append(title, notes, frame, links);
            views.append(panel);
            entries.push({ button, panel, frame, surface, width: screen.width, height: screen.height });
        }
        actual.onclick = () => {
            fitted = !fitted;
            actual.textContent = fitted ? "Actual size" : "Fit screen";
            actual.setAttribute("aria-pressed", String(!fitted));
            resize();
        };
        fragment.append(heading, notice, status, nav, actual, views);
        root.replaceChildren(fragment);
        select(selected);
        new ResizeObserver(resize).observe(views);
    } catch (cause) {
        renderers.forEach(renderer => renderer.dispose());
        throw cause;
    }
}

try {
    const payload: { current?: unknown; previous?: unknown } = JSON.parse(document.getElementById("ui-design-data")!.textContent!);
    try {
        render(readUiDesign(payload.current));
    } catch (cause) {
        error.hidden = false;
        error.textContent = `The requested design could not render: ${cause instanceof Error ? cause.message : String(cause)}.`;
        if (!payload.previous) throw cause;
        const previous = readUiDesign(payload.previous);
        render(previous);
        error.textContent += ` Showing retained ${uiDesignVersion(previous)}, not the requested update. Do not confirm the failed update.`;
    }
} catch (cause) {
    error.hidden = false;
    error.textContent = `No usable current preview: ${cause instanceof Error ? cause.message : String(cause)}. Supply actual structured state; do not reconstruct reviewed facts from chat.`;
}
