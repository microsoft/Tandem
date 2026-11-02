import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createTopics, DEFAULT_TOPIC_ID } from "./shared/topics.mjs";
import { BoardError, isRecord } from "./shared/scene.mjs";

export const SERVICE = "optional-whiteboard/v1";
const assets = fileURLToPath(new URL("./dist/", import.meta.url));
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".svg": "image/svg+xml" };
async function jsonBody(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size <= 2 * 1024 * 1024) chunks.push(chunk); }
  if (size > 2 * 1024 * 1024) throw new BoardError(413, "Request exceeds the prototype's 2 MiB limit.");
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new BoardError(400, "A JSON request body is required."); }
}
export async function startWhiteboard({ port = 0, assetsRoot = assets } = {}) {
  assetsRoot = await realpath(assetsRoot);
  await readFile(resolve(assetsRoot, "index.html"));
  const topics = createTopics(), board = topics.get().board, instanceId = randomUUID(), clients = new Map(), renderJobs = new Map();
  let url, renderer;
  const broadcast = (topicId) => {
    const data = `data: ${JSON.stringify(topics.state(topicId))}\n\n`;
    for (const [response, selectedTopicId] of clients) if (selectedTopicId === topicId) response.write(data);
  };
  const json = (response, status, value) => response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
  async function image(snapshot) {
    const token = randomUUID(); renderJobs.set(token, snapshot);
    let page;
    try {
      if (!renderer) {
        renderer = import("@playwright/test").then(({ chromium }) => chromium.launch({ headless: true,
          ...(process.platform === "win32" ? { channel: process.env.WHITEBOARD_BROWSER_CHANNEL ?? "msedge" } :
            process.env.WHITEBOARD_BROWSER_CHANNEL ? { channel: process.env.WHITEBOARD_BROWSER_CHANNEL } : {}) }));
      }
      page = await (await renderer).newPage();
      await page.goto(`${url}render?token=${token}`);
      await page.waitForFunction(() => window.__whiteboardRender !== undefined, undefined, { timeout: 20_000 });
      const result = await page.evaluate(() => window.__whiteboardRender);
      if (result.error) throw new Error(result.error);
      if (result.versionId !== snapshot.versionId || result.topicId !== snapshot.topicId) throw new Error("Renderer returned a different topic or sealed version.");
      return result;
    } catch (error) {
      throw new BoardError(503, `Sealed PNG rendering unavailable: ${error.message}. Use installed Edge or prepare Playwright Chromium; native reads remain available.`);
    } finally { renderJobs.delete(token); await page?.close(); }
  }
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (!url || request.headers.host !== new URL(url).host || request.headers.origin && request.headers.origin !== new URL(url).origin) {
      json(response, 403, { error: "Only this loopback origin is accepted." }); return;
    }
    let path;
    try { path = new URL(request.url, url); }
    catch { json(response, 400, { error: "Invalid request URL." }); return; }
    let requestedTopic;
    try {
      if (request.method === "GET" && path.pathname === "/health") {
        json(response, 200, { service: SERVICE, instanceId, url, pid: process.pid, memoryOnly: true, defaultTopicId: DEFAULT_TOPIC_ID }); return;
      }
      if (request.method === "GET" && path.pathname === "/events") {
        if (path.searchParams.get("instanceId") !== instanceId) throw new BoardError(403, "Viewer instance changed; reload explicitly.");
        const topic = topics.get(path.searchParams.has("topicId") ? path.searchParams.get("topicId") : DEFAULT_TOPIC_ID);
        response.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
        response.write(`event: topics\ndata: ${JSON.stringify(topics.list())}\n\n`);
        response.write(`data: ${JSON.stringify(topics.state(topic.topicId))}\n\n`); clients.set(response, topic.topicId);
        request.on("close", () => clients.delete(response)); return;
      }
      if (path.pathname === "/topics" && ["GET", "POST"].includes(request.method)) {
        if (request.headers["x-whiteboard-instance"] !== instanceId) throw new BoardError(403, "Wrong whiteboard instance.");
        if (request.method === "GET") { json(response, 200, topics.list()); return; }
        if (!request.headers["content-type"]?.startsWith("application/json")) throw new BoardError(415, "Use application/json.");
        const created = topics.create(await jsonBody(request));
        for (const [client] of clients) client.write(`event: topics\ndata: ${JSON.stringify(topics.list())}\n\n`);
        json(response, 201, created); return;
      }
      if (request.method === "GET" && path.pathname.startsWith("/render-job/")) {
        const snapshot = renderJobs.get(path.pathname.slice("/render-job/".length));
        if (!snapshot) throw new BoardError(404, "Render capture is unavailable.");
        json(response, 200, snapshot); return;
      }
      if (request.method === "POST" && ["/read", "/edit", "/seal", "/snapshot"].includes(path.pathname)) {
        if (request.headers["x-whiteboard-instance"] !== instanceId) throw new BoardError(403, "Wrong whiteboard instance.");
        if (!request.headers["content-type"]?.startsWith("application/json")) throw new BoardError(415, "Use application/json.");
        const body = await jsonBody(request);
        if (!isRecord(body)) throw new BoardError(400, "A JSON operation object is required.");
        const { topicId = DEFAULT_TOPIC_ID, ...input } = body;
        requestedTopic = topics.get(topicId);
        const activeBoard = requestedTopic.board;
        if (path.pathname === "/read" || path.pathname === "/snapshot") {
          const snapshotOnly = path.pathname === "/snapshot";
          if (snapshotOnly && (!isRecord(input) || Object.keys(input).some((key) => key !== "target"))) {
            throw new BoardError(400, "Use snapshot({target?: 'latest' | exactSealedVersionId}).");
          }
          const captured = { topicId, topicName: requestedTopic.name, ...activeBoard.read(input) };
          if (snapshotOnly || input.includeImage) captured.image = await image(captured);
          json(response, 200, snapshotOnly ? {
            topicId, topicName: requestedTopic.name, versionId: captured.versionId,
            sealed: true, hasUnsealedChanges: captured.hasUnsealedChanges, image: captured.image,
          } : captured);
        } else if (path.pathname === "/edit") {
          const result = activeBoard.edit(input); broadcast(topicId);
          json(response, 200, { topicId, topicName: requestedTopic.name, ...result });
        } else {
          const result = activeBoard.seal(input); broadcast(topicId);
          json(response, 200, { topicId, topicName: requestedTopic.name, ...result });
        }
        return;
      }
      if (request.method !== "GET") throw new BoardError(405, "Use the documented content operation endpoints.");
      const pathname = decodeURIComponent(path.pathname);
      if (pathname.includes("\\") || pathname.includes("\0")) throw new BoardError(400, "Invalid asset path.");
      const file = await realpath(resolve(assetsRoot, `.${pathname === "/" || pathname === "/render" ? "/index.html" : pathname}`));
      const suffix = relative(assetsRoot, file);
      if (suffix === ".." || suffix.startsWith(`..${sep}`) || isAbsolute(suffix)) throw new BoardError(403, "Outside viewer assets.");
      response.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" }).end(await readFile(file));
    } catch (error) {
      const status = error.status ?? (error.code === "ENOENT" ? 404 : 500);
      if (status >= 500) console.error("Whiteboard request failed:", error);
      json(response, status, { error: error.message, ...(status === 409 && requestedTopic
        ? { topicId: requestedTopic.topicId, versionId: requestedTopic.board.state().versionId } : {}) });
    }
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", done); });
  url = `http://127.0.0.1:${server.address().port}/`;
  return {
    server, board, topics, info: { service: SERVICE, instanceId, url, pid: process.pid, memoryOnly: true, defaultTopicId: DEFAULT_TOPIC_ID },
    async close() {
      for (const [client] of clients) client.end();
      try { if (renderer) await (await renderer).close(); }
      finally { await new Promise((done) => server.close(done)); }
    },
  };
}
