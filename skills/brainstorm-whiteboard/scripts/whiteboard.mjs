import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { SERVICE, startWhiteboard } from "../server.mjs";

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  port: { type: "string" }, url: { type: "string" }, json: { type: "string" }, input: { type: "string" }, assets: { type: "string" },
  topic: { type: "string" },
} });
try {
  const command = positionals[0];
  if (command === "serve") {
    const port = Number(values.port ?? 0);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Use a valid loopback port or 0.");
    const owned = await startWhiteboard({ port, ...(values.assets ? { assetsRoot: resolve(values.assets) } : {}) });
    console.log(JSON.stringify(owned.info));
    process.once("SIGINT", () => void owned.close());
    process.once("SIGTERM", () => void owned.close());
  } else {
    if (!["health", "topics", "create-topic", "read", "edit", "seal", "snapshot"].includes(command)) throw new Error("Use serve, health, topics, create-topic, read, edit, seal or snapshot.");
    const url = new URL(values.url);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password) throw new Error("Use the exact loopback URL printed at startup.");
    const health = await (await fetch(new URL("/health", url))).json();
    if (health.service !== SERVICE) throw new Error("This is not the optional whiteboard prototype; no old viewer was adopted.");
    if (command === "health") console.log(JSON.stringify(health));
    else if (command === "topics") {
      const response = await fetch(new URL("/topics", url), { headers: { "x-whiteboard-instance": health.instanceId } });
      const result = await response.json();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.error}`);
      console.log(JSON.stringify(result));
    }
    else {
      const body = values.input ? await readFile(values.input, "utf8") : values.json ?? (command === "read" || command === "snapshot" ? "{}" : null);
      if (body === null) throw new Error(command === "create-topic"
        ? 'Provide --json or --input with {"name":"Discussion name"}.'
        : "Provide --json or --input with the expectedVersionId.");
      const input = JSON.parse(body);
      if (values.topic !== undefined) {
        if (command === "create-topic") throw new Error("create-topic uses a name, not --topic.");
        if (input.topicId !== undefined && input.topicId !== values.topic) throw new Error("--topic conflicts with the request topicId.");
        input.topicId = values.topic;
      }
      const response = await fetch(new URL(command === "create-topic" ? "/topics" : `/${command}`, url), {
        method: "POST", headers: { "Content-Type": "application/json", "x-whiteboard-instance": health.instanceId }, body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.error}`);
      console.log(JSON.stringify(result));
    }
  }
} catch (error) {
  console.error(`Whiteboard: ${error.message}`); process.exitCode = 1;
}
