import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DesktopProtocol } from "./protocol.js";
import { runDesktopRuntime } from "./runtime.js";

const controller = new AbortController();
const protocol = new DesktopProtocol(process.stdin, process.stdout, () => controller.abort());
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

try {
    const { values } = parseArgs({ options: { workspace: { type: "string" } }, strict: true });
    if (!values.workspace) throw new Error("Launch Tandem with --workspace followed by a folder path.");
    await runDesktopRuntime({
        workspace: values.workspace, runtimeDirectory: dirname(fileURLToPath(import.meta.url)),
        protocol, signal: controller.signal,
    });
} catch (error) {
    if (!controller.signal.aborted) {
        protocol.send({ type: "error", message: error instanceof Error ? error.message : "The Tandem runtime failed." });
        process.exitCode = 1;
    }
} finally {
    protocol.send({ type: "stopped" });
    protocol.close();
}
