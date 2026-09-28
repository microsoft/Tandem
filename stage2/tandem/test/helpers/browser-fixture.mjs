import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const executable = process.env.TANDEM_BROWSER_EXECUTABLE ?? (process.platform === "win32"
  ? join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe") : "");
export const browserAvailable = existsSync(executable);
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

export async function openFixtureBrowser(t) {
  const profile = await mkdtemp(join(tmpdir(), "tandem-experience-browser-"));
  const child = spawn(executable, ["--headless=new", "--disable-gpu", "--disable-background-networking", "--no-first-run",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let launchError, socket;
  child.on("error", (error) => { launchError = error; });
  t.after(async () => {
    socket?.close();
    if (child.exitCode === null) {
      await Promise.race([new Promise((done) => child.once("exit", done)), pause(1000)]);
      if (child.exitCode === null) child.kill();
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 15, retryDelay: 200 });
  });
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (launchError) throw launchError;
    try { port = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; }
    catch (error) { if (!["ENOENT", "EBUSY"].includes(error.code)) throw error; await pause(100); }
  }
  if (!port) throw new Error("Fixture browser did not expose its owned debug port.");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(({ type }) => type === "page").webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject; });
  const pending = new Map(), exceptions = [];
  let sequence = 0;
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message));
      else request.done(message.result);
    }
  };
  const call = (method, params = {}) => new Promise((done, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); }, 10_000);
    pending.set(id, { done, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await call("Runtime.enable");
  await call("Page.enable");
  return {
    call, evaluate, exceptions,
    async waitFor(expression) {
      for (let attempt = 0; attempt < 150; attempt++) {
        if (await evaluate(expression)) return;
        await pause(30);
      }
      throw new Error(`Browser condition did not settle: ${expression}\n${JSON.stringify(exceptions)}`);
    },
    async screenshot(fullPage = false) {
      const size = fullPage ? (await call("Page.getLayoutMetrics")).cssContentSize : null;
      const image = await call("Page.captureScreenshot", {
        format: "png", captureBeyondViewport: fullPage,
        ...(size ? { clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 } } : {}),
      });
      return Buffer.from(image.data, "base64");
    },
  };
}
