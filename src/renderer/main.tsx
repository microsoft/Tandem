import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import { StudioStore } from "./state-store.js";

const root = document.getElementById("root");
if (!root) throw new Error("Tandem React root is missing.");
createRoot(root).render(<App store={new StudioStore()} version={root.dataset.version || ""} />);
