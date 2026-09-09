export const prototypePreviewBridgeSource: string = String.raw`(() => {
    "use strict";
    const LIMIT = 65536;
    const FIELD_LIMIT = 128;
    const warn = (message, error) => console.warn("[Tandem preview] " + message, error || "");
    let parentOrigin;
    try {
        const referrer = new URL(document.referrer);
        if (!["http:", "https:"].includes(referrer.protocol) || referrer.origin === "null" || window.parent === window) {
            throw new Error("A trusted embedded HTTP(S) parent is required.");
        }
        parentOrigin = referrer.origin;
    } catch (error) {
        warn("State bridge disabled: trusted parent referrer unavailable.", error);
        return;
    }
    const sensitive = (value) => {
        const name = String(value).replace(/[^a-z0-9]/gi, "").toLowerCase();
        return /password|passwd|pwd|secret|token|credential|authorization|authentication|apikey|creditcard|cardnumber|cardholder|securitycode|cvv|cvc|socialsecurity|ssn|bankaccount|accountnumber|iban|routingnumber|onetime|otp|csrf|sessionid/.test(name) ||
            /^(?:auth|session|sid|nonce|pin|username|login|card|cc|csc)$/.test(name);
    };
    const sensitiveValue = (value) => /(?:bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:ghp|github_pat|sk_live|sk_test)[_-][A-Za-z0-9_-]+)/i.test(String(value));
    const size = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
    function clone(value) {
        let nodes = 0;
        function clean(item, depth) {
            if (++nodes > 4000 || depth > 12) throw new Error("State is too complex.");
            if (item === null || typeof item === "boolean") return item;
            if (typeof item === "number" && Number.isFinite(item)) return item;
            if (typeof item === "string" && item.length <= 8192 && !sensitiveValue(item)) return item;
            if (Array.isArray(item)) return item.map((child) => clean(child, depth + 1));
            if (item && Object.prototype.toString.call(item) === "[object Object]") {
                const result = {};
                for (const key of Object.keys(item)) {
                    if (["__proto__", "constructor", "prototype"].includes(key) || sensitive(key)) continue;
                    result[key] = clean(item[key], depth + 1);
                }
                return result;
            }
            throw new Error("State must contain bounded, non-sensitive JSON values.");
        }
        const result = clean(value, 0);
        if (size(result) > LIMIT) throw new Error("State exceeds 64 KiB.");
        return result;
    }
    let basePath = "/";
    try {
        const base = document.querySelector("base[href]");
        if (base) {
            const url = new URL(base.getAttribute("href"), window.location.href);
            if (url.origin !== window.location.origin) throw new Error("App base must have the preview origin.");
            basePath = url.pathname.endsWith("/") ? url.pathname : url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1);
        }
    } catch (error) {
        warn("State bridge disabled: invalid app base.", error);
        return;
    }
    function route(value) {
        if (typeof value !== "string" || value.length > 8192 || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
        const url = new URL(value, window.location.origin);
        if (url.origin !== window.location.origin || !url.pathname.startsWith(basePath)) return null;
        for (const [key, value] of Array.from(url.searchParams.entries())) {
            if (sensitive(key) || /^(?:code|key|auth|session|sid)$/i.test(key) || sensitiveValue(value)) url.searchParams.delete(key);
        }
        if (sensitive(url.hash) || sensitiveValue(url.hash)) url.hash = "";
        return url.pathname + url.search + url.hash;
    }
    const attr = (element, name) => element.getAttribute(name) || "";
    function allowed(element) {
        const type = (element.type || "").toLowerCase();
        if (element.disabled || element.closest("[data-tandem-preview-private]") ||
            ["password", "file", "hidden", "email", "tel", "submit", "reset", "button", "image"].includes(type)) return false;
        const autocomplete = attr(element, "autocomplete").toLowerCase();
        return ![element.id, element.name, autocomplete, attr(element, "aria-label")].some(sensitive) &&
            !/(?:^|\s)(?:off|cc-[\w-]+|current-password|new-password|one-time-code|email|tel[\w-]*|street-address|address-line\d|bday[\w-]*)(?:\s|$)/.test(autocomplete) &&
            Boolean(element.id || element.name);
    }
    function controls() {
        const seen = new Map();
        return Array.from(document.querySelectorAll("input, textarea, select")).filter(allowed).map((element) => {
            const key = {
                id: element.id || "", name: element.name || "", tag: element.tagName.toLowerCase(),
                type: (element.type || "").toLowerCase(), formId: element.form?.id || "", formName: element.form?.name || ""
            };
            const signature = JSON.stringify(key);
            const index = seen.get(signature) || 0;
            seen.set(signature, index + 1);
            return { element, key: { ...key, index } };
        });
    }
    const coordinate = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10000000;
    function capture() {
        const state = {
            version: 1,
            route: route(window.location.pathname + window.location.search + window.location.hash),
            scroll: { x: coordinate(window.scrollX) ? window.scrollX : 0, y: coordinate(window.scrollY) ? window.scrollY : 0 },
            fields: []
        };
        for (const { element, key } of controls().slice(0, FIELD_LIMIT)) {
            let value;
            if (["checkbox", "radio"].includes(key.type)) value = Boolean(element.checked);
            else if (element.multiple && element.options) value = Array.from(element.options).filter((option) => option.selected).map((option) => option.value);
            else value = element.value;
            if (typeof value === "string" && (value.length > 4096 || sensitiveValue(value))) continue;
            if (Array.isArray(value) && value.some((item) => typeof item !== "string" || item.length > 4096 || sensitiveValue(item))) continue;
            state.fields.push({ key, value });
            if (size(state) > LIMIT - 4096) { state.fields.pop(); break; }
        }
        if (typeof window.tandemPreviewState?.capture === "function") {
            try {
                const app = clone(window.tandemPreviewState.capture());
                if (size({ ...state, app }) > LIMIT - 1024) throw new Error("App state exceeds the remaining message budget.");
                state.app = app;
            } catch (error) { warn("App state capture failed; ordinary preview state remains available.", error); }
        }
        return clone(state);
    }
    function setValue(element, property, value) {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), property)?.set;
        if (setter) setter.call(element, value);
        else element[property] = value;
    }
    function restore(input) {
        const state = clone(input);
        if (!state || state.version !== 1 || !Array.isArray(state.fields) || state.fields.length > FIELD_LIMIT) throw new Error("Unsupported preview state.");
        const nextRoute = state.route === null ? null : route(state.route);
        if (state.route !== null && nextRoute === null) throw new Error("Route is outside this preview app.");
        if (nextRoute !== null) {
            const previousURL = window.location.href;
            const nextURL = new URL(nextRoute, window.location.origin);
            window.history.replaceState(null, "", nextRoute);
            window.dispatchEvent(new Event("popstate"));
            if (new URL(previousURL).hash !== nextURL.hash) {
                window.dispatchEvent(typeof HashChangeEvent === "function" ?
                    new HashChangeEvent("hashchange", { oldURL: previousURL, newURL: nextURL.href }) : new Event("hashchange"));
            }
        }
        window.requestAnimationFrame(() => {
            try {
                const current = controls();
                for (const field of state.fields) {
                    if (!field || !field.key) continue;
                    const match = current.find(({ key }) => Object.keys(key).every((name) => key[name] === field.key[name]));
                    if (!match) continue;
                    const { element, key } = match;
                    if (["checkbox", "radio"].includes(key.type) && typeof field.value === "boolean") setValue(element, "checked", field.value);
                    else if (element.multiple && element.options && Array.isArray(field.value) && field.value.every((value) => typeof value === "string" && value.length <= 4096)) {
                        for (const option of Array.from(element.options)) option.selected = field.value.includes(option.value);
                    } else if (typeof field.value === "string" && field.value.length <= 4096 && !sensitiveValue(field.value) && !["checkbox", "radio"].includes(key.type)) setValue(element, "value", field.value);
                    else continue;
                    element.dispatchEvent(new Event("input", { bubbles: true }));
                    element.dispatchEvent(new Event("change", { bubbles: true }));
                }
                if (Object.hasOwn(state, "app") && typeof window.tandemPreviewState?.restore === "function") {
                    try { window.tandemPreviewState.restore(state.app); }
                    catch (error) { warn("App state restore failed.", error); }
                }
                if (state.scroll && coordinate(state.scroll.x) && coordinate(state.scroll.y)) window.scrollTo(state.scroll.x, state.scroll.y);
            } catch (error) { warn("Preview state restore failed.", error); }
        });
    }
    window.addEventListener("message", (event) => {
        if (event.source !== window.parent || event.origin !== parentOrigin) return;
        const message = event.data;
        if (!message || typeof message !== "object") return;
        const prototypeId = document.querySelector('meta[name="tandem-prototype-id"]')?.getAttribute("content");
        if (!prototypeId || prototypeId.length > 160 || message.prototypeId !== prototypeId) return;
        try {
            if (message.type === "tandem:preview:capture") {
                if (typeof message.requestId !== "string" || !message.requestId || message.requestId.length > 200) return;
                const reply = { type: "tandem:preview:state", requestId: message.requestId, prototypeId, state: capture() };
                if (size(reply) > LIMIT) throw new Error("Preview message exceeds 64 KiB.");
                window.parent.postMessage(reply, parentOrigin);
            } else if (message.type === "tandem:preview:restore") {
                restore(message.state);
            }
        } catch (error) { warn("Preview state request failed.", error); }
    });
})();`;
