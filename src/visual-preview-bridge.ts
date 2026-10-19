import { visualManifestName, visualSettingsValues } from "./visual-directions.js";

const wireframeStyles = String.raw`
html[data-tandem-accent="neutral"] {
    --tandem-wireframe-surface: #ffffff;
    --tandem-wireframe-muted: #f5f5f5;
    --tandem-wireframe-text: #262626;
    --tandem-wireframe-border: #a3a3a3;
}
html[data-tandem-accent="neutral"][data-tandem-color-mode="dark"] {
    --tandem-wireframe-surface: #171717;
    --tandem-wireframe-muted: #262626;
    --tandem-wireframe-text: #e5e5e5;
    --tandem-wireframe-border: #737373;
}
html[data-tandem-accent="neutral"] body {
    background: var(--tandem-wireframe-surface) !important;
    color: var(--tandem-wireframe-text) !important;
    font-family: system-ui, sans-serif !important;
}
html[data-tandem-accent="neutral"] :is(header, nav, aside, main, section, article, fieldset, [role="dialog"]) {
    background-color: var(--tandem-wireframe-surface) !important;
    border-color: var(--tandem-wireframe-border) !important;
}
html[data-tandem-accent="neutral"] :is(h1, h2, h3, h4, h5, h6, button, input, textarea, select, label, p, a) {
    color: var(--tandem-wireframe-text) !important;
    font-family: system-ui, sans-serif !important;
}
html[data-tandem-accent="neutral"] :is(button, input, textarea, select, [role="button"], [role="tab"]) {
    background: var(--tandem-wireframe-surface) !important;
    color: var(--tandem-wireframe-text) !important;
    border: 1px solid var(--tandem-wireframe-border) !important;
    border-radius: 2px !important;
}
html[data-tandem-accent="neutral"] :is([aria-current]:not([aria-current="false"]), [aria-selected="true"], [aria-pressed="true"]) {
    background-color: var(--tandem-wireframe-muted) !important;
}
html[data-tandem-accent="neutral"] :is(img, svg, canvas, video) { filter: grayscale(1); }
html[data-tandem-accent="neutral"][data-tandem-effects="none"] *,
html[data-tandem-accent="neutral"][data-tandem-effects="none"] *::before,
html[data-tandem-accent="neutral"][data-tandem-effects="none"] *::after {
    box-shadow: none !important;
    text-shadow: none !important;
}
`;

export const visualPreviewBridgeSource = String.raw`(() => {
    "use strict";
    if (!document.querySelector('meta[name="tandem-visual-exploration"][content="1"]')) return;
    const values = ${JSON.stringify(visualSettingsValues)};
    const manifestUrl = new URL(${JSON.stringify(visualManifestName)}, window.location.href);
    const prototypeId = document.querySelector('meta[name="tandem-prototype-id"]')?.content;
    const checkpointId = document.querySelector('meta[name="tandem-prototype-checkpoint"]')?.content;
    let manifest, selection, parentOrigin = null;
    if (window.parent !== window && document.referrer) {
        try {
            const referrer = new URL(document.referrer);
            if (!["http:", "https:"].includes(referrer.protocol)) throw new Error("Visual controls require an HTTP(S) parent.");
            parentOrigin = referrer.origin;
        } catch (reason) { console.warn("[Tandem visual preview] Parent bridge unavailable.", reason); }
    }
    const error = (reason) => {
        console.error("[Tandem visual preview]", reason);
        let notice = document.getElementById("tandem-visual-error");
        if (!notice) {
            notice = document.createElement("p");
            notice.id = "tandem-visual-error";
            notice.setAttribute("role", "alert");
            (document.body || document.documentElement).prepend(notice);
        }
        notice.textContent = "Visual controls unavailable: " + (reason instanceof Error ? reason.message : String(reason));
    };
    function validate(value) {
        if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== "directionId,settings" ||
            !manifest.directions.some(direction => direction.id === value.directionId) ||
            !value.settings || Object.keys(value.settings).sort().join(",") !== Object.keys(values).sort().join(",") ||
            Object.entries(values).some(([key, choices]) => !choices.includes(value.settings[key]))) {
            throw new Error("The selected direction or its settings do not match this saved preview.");
        }
        return JSON.parse(JSON.stringify(value));
    }
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    function apply(value) {
        selection = validate(value);
        const root = document.documentElement, settings = selection.settings;
        const effectiveEffects = reducedMotion.matches ? "none" : settings.effects;
        root.setAttribute("data-tandem-direction", selection.directionId);
        root.setAttribute("data-tandem-color-mode", settings.colorMode);
        root.setAttribute("data-tandem-accent", settings.accent);
        root.setAttribute("data-tandem-density", settings.density);
        root.setAttribute("data-tandem-text-size", settings.textSize);
        root.setAttribute("data-tandem-effects", effectiveEffects);
        const accents = settings.colorMode === "dark"
            ? { neutral: "#d4d4d4", blue: "#93c5fd", teal: "#5eead4", violet: "#c4b5fd", amber: "#fcd34d" }
            : { neutral: "#525252", blue: "#1d4ed8", teal: "#0f766e", violet: "#6d28d9", amber: "#92400e" };
        root.style.setProperty("--tandem-accent", accents[settings.accent]);
        root.style.setProperty("--tandem-accent-contrast", settings.colorMode === "dark" ? "#111827" : "#ffffff");
        root.style.setProperty("--tandem-spacing-scale", settings.density === "compact" ? "0.82" : "1");
        root.style.setProperty("--tandem-text-scale", settings.textSize === "large" ? "1.125" : "1");
        root.style.setProperty("--tandem-motion-duration", effectiveEffects === "none" ? "0ms" : "160ms");
        root.style.colorScheme = settings.colorMode;
        const url = new URL(window.location.href);
        url.searchParams.set("tandem-direction", selection.directionId);
        for (const [key, value] of Object.entries(settings)) url.searchParams.set("tandem-" + key, value);
        window.history.replaceState(window.history.state, "", url);
        window.dispatchEvent(new CustomEvent("tandem:visual-change", {
            detail: { selection: JSON.parse(JSON.stringify(selection)), effectiveEffects }
        }));
        document.getElementById("tandem-visual-error")?.remove();
        return { selection, effectiveEffects };
    }
    window.addEventListener("message", event => {
        const message = event.data;
        if (!parentOrigin || event.source !== window.parent || event.origin !== parentOrigin ||
            message?.type !== "tandem:visual:apply" || message.prototypeId !== prototypeId ||
            message.checkpointId !== checkpointId || typeof message.requestId !== "string" ||
            !message.requestId || message.requestId.length > 120) return;
        try {
            if (!manifest) throw new Error("The visual manifest is not ready yet. Check the preview again.");
            const result = apply(message.selection);
            window.parent.postMessage({ type: "tandem:visual:applied", prototypeId, checkpointId,
                requestId: message.requestId, ...result }, parentOrigin);
        } catch (reason) {
            error(reason);
            window.parent.postMessage({ type: "tandem:visual:error", prototypeId, checkpointId,
                requestId: message.requestId, error: reason instanceof Error ? reason.message : String(reason) }, parentOrigin);
        }
    });
    reducedMotion.addEventListener("change", () => {
        if (selection) { try { apply(selection); } catch (reason) { error(reason); } }
    });
    const style = document.createElement("style");
    style.textContent = ${JSON.stringify(wireframeStyles)} + 'html[data-tandem-effects="none"] *, html[data-tandem-effects="none"] *::before, html[data-tandem-effects="none"] *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }';
    document.head.append(style);
    void (async () => {
        try {
            const response = await fetch(manifestUrl, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5000) });
            if (!response.ok) throw new Error("The saved visual manifest returned HTTP " + response.status + ".");
            if (!response.body) throw new Error("The saved visual manifest has no content.");
            const reader = response.body.getReader(), decoder = new TextDecoder();
            let text = "", bytes = 0;
            try {
                for (;;) {
                    const chunk = await reader.read();
                    if (chunk.done) break;
                    bytes += chunk.value.byteLength;
                    if (bytes > 32768) throw new Error("Visual manifest exceeds 32 KiB.");
                    text += decoder.decode(chunk.value, { stream: true });
                }
                text += decoder.decode();
            } finally { await reader.cancel(); }
            manifest = JSON.parse(text);
            if (manifest?.version !== 1 || !Array.isArray(manifest.directions) ||
                manifest.directions.length < 2 || manifest.directions.length > 3) throw new Error("Invalid visual manifest.");
            const params = new URL(window.location.href).searchParams;
            const initial = validate(manifest.defaultSelection);
            if (params.has("tandem-direction")) {
                initial.directionId = params.get("tandem-direction");
                const direction = manifest.directions.find(item => item.id === initial.directionId);
                if (!direction) throw new Error("This direction is not in the saved preview.");
                initial.settings = { ...direction.defaults };
            }
            for (const key of Object.keys(values)) if (params.has("tandem-" + key)) initial.settings[key] = params.get("tandem-" + key);
            apply(initial);
            if (parentOrigin) window.parent.postMessage({ type: "tandem:visual:ready", prototypeId, checkpointId }, parentOrigin);
        } catch (reason) { error(reason); }
    })();
})();`;
