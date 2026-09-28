import { createRoot } from "react-dom/client";
import { BrowserApp } from "./app.js";
import { BrowserStore, readLaunchCapability } from "./client.js";

const root = document.getElementById("root");
if (!root) throw new Error("Tandem host page is missing its root element.");
try {
    const token = readLaunchCapability(window.location, window.sessionStorage, window.history);
    createRoot(root).render(<BrowserApp store={new BrowserStore(token)} />);
} catch (error) {
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.className = "host-bootstrap-error";
    message.textContent = error instanceof Error ? error.message : String(error);
    root.replaceChildren(message);
}
