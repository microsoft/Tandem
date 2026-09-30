import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer as createPortReservation } from "node:net";
import { lstat, mkdir, realpath } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { FoundationStorage, decodeRecord, encodeRecord } from "../runtime-src/domain/workflow/foundation-storage.ts";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { requireCondition } from "../runtime-src/domain/workflow/validation.ts";

const ended = new Set(["completed", "failed", "stopped"]);
const protectedParts = new Set([".git", ".tandem", "tandem.md", ".teleos", "teleos.md", ".tandem-migration.lock"]);
const inside = (root, path) => {
  const tail = relative(root, path);
  return tail === "" || (!isAbsolute(tail) && tail !== ".." && !tail.startsWith(`..${sep}`));
};
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function localPath(root, input, directory = false) {
  requireCondition(typeof input === "string" && !input.includes("\0"), "Invalid workspace path.");
  const path = resolve(root, input.replaceAll("\\", sep));
  requireCondition(inside(root, path)
    && !relative(root, path).split(sep).some((part) => protectedParts.has(part.toLowerCase())),
  "Command working directory and app paths must stay in the owned workspace.");
  for (let current = path;; current = dirname(current)) {
    const stat = await lstat(current);
    requireCondition(!stat.isSymbolicLink(), "App paths cannot contain symbolic links or junctions.");
    if (current === root) break;
  }
  const stat = await lstat(path);
  requireCondition(directory ? stat.isDirectory() : stat.isFile(), directory ? "Working directory is unavailable." : "App entrypoint is not a regular file.");
  return path;
}

async function availablePort(port) {
  requireCondition(Number.isSafeInteger(port) && port >= 0 && port <= 65535, "Invalid local app port.");
  const reservation = createPortReservation();
  await new Promise((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(port, "127.0.0.1", resolve);
  });
  const selected = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  return selected;
}

export class WorkflowCommandRunner {
  #owner;
  #node;
  #directory;
  #storage;
  #record;
  #loadPromise;
  #writes = Promise.resolve();
  #persistedContent;
  #launches = Promise.resolve();
  #handles = new Map();
  #closed = false;
  #workspacePath;
  #schema;

  constructor({ owner, runtimeDirectory, nodeExecutable, repositoryRoot = owner.workspacePath ?? owner.targetWorktreePath }) {
    this.#owner = owner;
    this.#workspacePath = owner.schemaVersion === "human-loop-owner/v1" ? owner.workspacePath : owner.worktreePath;
    this.#schema = owner.schemaVersion === "human-loop-owner/v1" ? "human-loop-commands/v1" : "workflow-commands/v1";
    requireCondition(isAbsolute(this.#workspacePath), "Command execution needs the exact owned workspace.");
    this.#node = nodeExecutable;
    this.#directory = join(runtimeDirectory, "commands");
    this.#storage = new FoundationStorage(this.#directory, undefined, owner.policy, { workspaceRoot: repositoryRoot });
  }

  async #load() {
    this.#loadPromise ??= (async () => {
      const content = await this.#storage.read("commands.json");
      this.#persistedContent = content;
      this.#record = content === undefined
        ? { schemaVersion: this.#schema, ownerDigest: policyHash(this.#owner), entries: [] }
        : decodeRecord(content);
      requireCondition(this.#record.schemaVersion === this.#schema
        && this.#record.ownerDigest === policyHash(this.#owner) && Array.isArray(this.#record.entries)
        && this.#record.entries.every((entry) => typeof entry.id === "string" && typeof entry.status === "string"),
      "Saved command ownership is invalid; no process will be adopted.");
    })();
    await this.#loadPromise;
  }

  #save() {
    const content = encodeRecord(this.#record);
    const write = this.#writes.then(async () => {
      if (!this.#storage.writerId) await this.#storage.acquireWriter();
      await this.#storage.mutate("commands.json", "record-command-lifecycle", (original) => {
        requireCondition(original === this.#persistedContent, "Command state changed outside its observed version; refuse a stale overwrite.");
        return { content, result: null };
      });
      this.#persistedContent = content;
    });
    this.#writes = write;
    return write;
  }

  #view(entry) {
    const missingOwner = !ended.has(entry.status) && !this.#handles.has(entry.id);
    return {
      id: entry.id, mode: entry.mode, status: missingOwner ? "held" : entry.status,
      command: entry.command, pid: entry.pid, url: entry.status === "running" ? entry.url : null,
      exitCode: entry.exitCode, output: entry.output,
      reason: missingOwner ? "Saved process has no live owned handle; it will not be adopted or killed by PID." : entry.reason,
      startedAt: entry.startedAt, endedAt: entry.endedAt,
      canStop: !missingOwner && !ended.has(entry.status) && entry.status !== "stopping",
    };
  }

  async read() {
    await this.#load();
    await this.#writes;
    return {
      schemaVersion: "workflow-processes-view/v1",
      apps: this.#record.entries.filter(({ mode }) => mode !== "command").map((entry) => this.#view(entry)),
      commands: this.#record.entries.filter(({ mode }) => mode === "command").map((entry) => this.#view(entry)),
    };
  }

  async evidenceForCycle(cycleId) {
    await this.#load(); await this.#writes;
    requireCondition(this.#schema === "human-loop-commands/v1", "Whole-cycle command evidence requires the new execution model.");
    return this.#record.entries.filter((entry) => entry.observations?.some((value) => value.cycleId === cycleId))
      .map((entry) => ({ ...this.#view(entry), specification: structuredClone(entry.specification),
        observations: entry.observations.filter((value) => value.cycleId === cycleId) }));
  }

  async cleanCloseDigest() {
    await this.#load(); await this.#writes;
    requireCondition(this.#schema === "human-loop-commands/v1"
      && this.#record.entries.every((entry) => ended.has(entry.status)),
    "Command or preview work is not settled for clean session continuity.");
    return policyHash(this.#record);
  }

  async #executable(command, cwd) {
    requireCondition(typeof command === "string" && command.length > 0 && !command.includes("\0"), "A command executable is required.");
    if (command === "node") {
      requireCondition(this.#node, "A trusted Node executable is not configured.");
      return { file: this.#node, prefix: [] };
    }
    const packageManager = process.platform === "win32" ? /^(npm|npx)(?:\.cmd)?$/i.exec(command)?.[1].toLowerCase()
      : ["npm", "npx"].includes(command) ? command : null;
    if (packageManager && this.#node) {
      const file = join(dirname(this.#node), "node_modules", "npm", "bin", `${packageManager}-cli.js`);
      requireCondition((await lstat(file)).isFile(), "The installed package-manager entrypoint is unavailable.");
      return { file: this.#node, prefix: [file] };
    }
    requireCondition(!/\.(?:cmd|bat|ps1)$/i.test(command),
      "Batch and PowerShell script launch is unsupported. Use an executable with an argument array; npm/npx use the pinned Node CLI.");
    if (isAbsolute(command) || /[\\/]/.test(command)) {
      const file = isAbsolute(command) ? await realpath(command) : await localPath(this.#workspacePath, relative(this.#workspacePath, resolve(cwd, command)));
      requireCondition((await lstat(file)).isFile() && !/\.(?:cmd|bat|ps1)$/i.test(file),
        "Use an executable and argument array, not an implicitly interpreted batch file.");
      return { file, prefix: [] };
    }
    const environmentPath = Object.entries(process.env).find(([name]) => name.toUpperCase() === "PATH")?.[1] ?? "";
    for (const directory of environmentPath.split(delimiter)) {
      if (!isAbsolute(directory)) continue;
      for (const suffix of process.platform === "win32" ? ["", ".exe", ".com"] : [""]) {
        const file = join(directory.replace(/^"|"$/g, ""), `${command}${suffix}`);
        try {
          if ((await lstat(file)).isFile()) return { file: await realpath(file), prefix: [] };
        } catch (error) {
          if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error;
        }
      }
    }
    throw new Error(`Installed executable was not found: ${command}`);
  }

  async validateCommand(input) {
    const cwd = await localPath(this.#workspacePath, input.cwd ?? ".", true);
    return { cwd, executable: await this.#executable(input.command, cwd) };
  }

  async #newEntry(mode, specification, context) {
    await this.#load();
    requireCondition(!this.#closed, "Command runner is closed.");
    requireCondition(this.#record.entries.every((entry) => ended.has(entry.status) || this.#handles.has(entry.id)),
      "Saved process work lacks live ownership; no new process will be created.");
    requireCondition(this.#record.entries.length < this.#owner.policy.values.resources.reviewCollections,
      "The pinned command-history collection limit has been reached.");
    const taskId = context.task.schemaVersion === "human-loop-task/v1" ? context.task.binding.id : context.task.taskId;
    requireCondition(typeof taskId === "string" && taskId, "Command has no owned task identity.");
    const invocation = policyHash({ taskId, callId: context.toolCallId });
    const digest = policyHash({ mode, specification });
    const observation = context.task.schemaVersion === "human-loop-task/v1"
      ? { taskId, cycleId: context.task.binding.cycleId, requestId: context.task.binding.requestId, toolCallId: context.toolCallId } : null;
    const existing = this.#record.entries.find((entry) => entry.invocation === invocation);
    if (existing) {
      requireCondition(existing.digest === digest, "A command invocation was reused with different inputs.");
      return { entry: existing, existing: true };
    }
    if (mode !== "command") {
      const running = this.#record.entries.find((entry) => entry.digest === digest && !ended.has(entry.status));
      if (running) {
        if (observation && !running.observations?.some((value) => value.taskId === taskId && value.toolCallId === context.toolCallId)) {
          running.observations ??= []; running.observations.push(observation); await this.#save();
        }
        return { entry: running, existing: true };
      }
    }
    const entry = {
      id: randomUUID(), invocation, digest, mode, status: "starting",
      command: specification.command,
      specification,
      ...(observation ? { observations: [observation] } : {}),
      pid: null, url: null, exitCode: null, output: "", reason: null,
      startedAt: new Date().toISOString(), endedAt: null,
    };
    this.#record.entries.push(entry);
    this.#handles.set(entry.id, { pending: true });
    await this.#save();
    return { entry, existing: false };
  }

  #serializeLaunch(operation) {
    const pending = this.#launches.then(operation);
    this.#launches = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async #launch(mode, input, context) {
    return this.#serializeLaunch(async () => {
      context.signal.throwIfAborted();
      context.validatePaths();
      requireCondition(Buffer.byteLength(JSON.stringify(input), "utf8") <= this.#owner.policy.values.resources.requestBytes,
        "Command input exceeds its pinned resource bound.");
      requireCondition(Array.isArray(input.args) && input.args.every((value) => typeof value === "string" && !value.includes("\0")),
        "Command arguments must be an explicit string array.");
      if (mode === "server") {
        const path = input.readinessPath ?? "/";
        requireCondition(typeof path === "string" && path.startsWith("/") && !path.startsWith("//") && !path.includes("\\"),
          "Readiness must be a path on the assigned loopback URL.");
      }
      const { cwd, executable } = await this.validateCommand(input);
      const specification = { command: input.command, args: [...input.args], cwd, ...(mode === "server" ? { port: input.port ?? 0, readinessPath: input.readinessPath ?? "/" } : {}) };
      const { entry, existing } = await this.#newEntry(mode, specification, context);
      if (existing) return entry;
      try {
        const port = mode === "server" ? await availablePort(input.port ?? 0) : null;
        const dataDirectory = join(this.#directory, entry.id, "data");
        await mkdir(dataDirectory, { recursive: true });
        const args = [...executable.prefix, ...input.args.map((value) =>
          value.replaceAll("{port}", String(port ?? "")).replaceAll("{dataDirectory}", dataDirectory))];
        const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
          /^(?:PATH|PATHEXT|HOME|USERPROFILE|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|APPDATA|LOCALAPPDATA|PROGRAMFILES(?:\(X86\))?|LANG|LC_ALL|NUMBER_OF_PROCESSORS)$/i.test(name)));
        Object.assign(env, { HOST: "127.0.0.1", LIVING_CANVAS_DATA_DIR: dataDirectory });
        if (port !== null) env.PORT = String(port);
        context.signal.throwIfAborted();
        context.validatePaths();
        const child = spawn(executable.file, args, { cwd, env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        const finished = Promise.withResolvers();
        const handle = { child, finished: finished.promise, settled: false, done: finished };
        this.#handles.set(entry.id, handle);
        const append = (text) => { entry.output = (entry.output + text).slice(-this.#owner.policy.values.resources.reviewExcerptCharacters); };
        child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
        child.stdout.on("data", append); child.stderr.on("data", append);
        const finish = async (code, failure) => {
          if (handle.settled) return;
          handle.settled = true;
          entry.exitCode = code;
          entry.status = entry.status === "stopping" ? "stopped" : failure || code !== 0 ? "failed" : "completed";
          entry.reason = failure ?? entry.reason;
          entry.endedAt = new Date().toISOString();
          try { await this.#save(); finished.resolve(); } catch (error) { finished.reject(error); }
        };
        child.once("error", (error) => { void finish(null, `Process could not start: ${error.code ?? error.message}`); });
        child.once("close", (code) => { void finish(code, null); });
        await new Promise((resolve) => { child.once("spawn", resolve); child.once("error", resolve); });
        if (!handle.settled) {
          entry.pid = child.pid;
          entry.status = mode === "command" ? "running" : "starting";
          if (port !== null) {
            const url = new URL(input.readinessPath ?? "/", `http://127.0.0.1:${port}/`);
            requireCondition(url.origin === `http://127.0.0.1:${port}`, "Readiness must remain on the assigned loopback port.");
            handle.expectedUrl = url.href;
          }
          await this.#save();
        }
        return entry;
      } catch (error) {
        entry.status = "failed"; entry.reason = error.message; entry.endedAt = new Date().toISOString();
        await this.#save();
        throw error;
      }
    });
  }

  async run(input, context) {
    const entry = await this.#launch("command", input, context);
    const handle = this.#handles.get(entry.id);
    if (ended.has(entry.status)) return this.#view(entry);
    let timer;
    const interrupted = Promise.withResolvers();
    const stop = () => { void this.stop(entry.id).then(interrupted.resolve, interrupted.reject); };
    context.signal.addEventListener("abort", stop, { once: true });
    if (context.signal.aborted) stop();
    timer = setTimeout(stop, this.#owner.policy.values.time.attemptMaximumMs);
    try { await Promise.race([handle.finished, interrupted.promise]); }
    finally { clearTimeout(timer); context.signal.removeEventListener("abort", stop); }
    return this.#view(entry);
  }

  async start(input, context) {
    const entry = await this.#launch("server", input, context);
    if (ended.has(entry.status) || entry.status === "running") return this.#view(entry);
    const handle = this.#handles.get(entry.id);
    const deadline = Date.now() + this.#owner.policy.values.time.attemptMinimumMs;
    while (!ended.has(entry.status) && Date.now() < deadline && !context.signal.aborted) {
      try {
        const response = await fetch(handle.expectedUrl, { redirect: "manual", signal: AbortSignal.timeout(this.#owner.policy.values.time.activityRefreshMs) });
        if (response.status < 400 && !handle.settled) {
          entry.status = "running"; entry.url = handle.expectedUrl;
          await this.#save();
          return this.#view(entry);
        }
      } catch (error) {
        if (!(error instanceof TypeError) && !["TimeoutError", "AbortError"].includes(error.name)) throw error;
      }
      await delay(this.#owner.policy.values.time.activityDebounceMs);
    }
    if (!ended.has(entry.status)) {
      await this.stop(entry.id);
      entry.status = "failed";
      entry.reason = context.signal.aborted ? "App startup was cancelled." : "The app did not respond at its requested loopback URL.";
      await this.#save();
    }
    return this.#view(entry);
  }

  async stop(id) {
    await this.#launches;
    await this.#load();
    const entry = this.#record.entries.find((entry) => entry.id === id);
    requireCondition(entry, "Unknown owned process ID.");
    if (ended.has(entry.status)) return this.#view(entry);
    const handle = this.#handles.get(id);
    requireCondition(handle && !handle.pending, "No live owned process handle exists; stored PIDs will not be killed.");
    if (handle.stopping) return handle.stopping;
    handle.stopping = this.#stopOwned(entry, handle);
    return handle.stopping;
  }

  async #stopOwned(entry, handle) {
    entry.status = "stopping";
    await this.#save();
    if (!handle.settled && handle.child.exitCode === null) {
      if (process.platform === "win32") {
        const script = `$rootId=${handle.child.pid}; function Stop-Children([int]$parent) { Get-CimInstance Win32_Process -Filter \"ParentProcessId=$parent\" | ForEach-Object { Stop-Children $_.ProcessId; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }; Stop-Children $rootId`;
        await promisify(execFile)(join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
          ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout: this.#owner.policy.values.time.reviewGraceMs });
      }
      if (!handle.settled) handle.child.kill();
    }
    await handle.finished;
    return this.#view(entry);
  }

  async stopAll() {
    await this.#load();
    for (const entry of this.#record.entries) if (!ended.has(entry.status) && this.#handles.has(entry.id)) await this.stop(entry.id);
  }

  async close({ releaseStorage = true } = {}) {
    this.#closed = true;
    await this.stopAll();
    await this.#writes;
    if (releaseStorage) await this.#storage.close();
  }
}

export function workflowCommandTools(runner, policy, options = {}) {
  const path = { type: "string", minLength: 1, maxLength: policy.values.resources.reviewSavedPathCharacters };
  const properties = {
    command: path, args: { type: "array", maxItems: policy.values.resources.reviewCollections, items: { type: "string" } },
    purpose: { type: "string", minLength: 1, maxLength: 500, description: "Briefly explain why this command is needed for the user's request." },
    cwd: path, port: { type: "integer", minimum: 0, maximum: 65535 }, readinessPath: path,
  };
  const permitted = options.authorize ?? ((context) => {
    requireCondition(context.task.coordination?.kind === "agent"
      || (!context.task.coordination && !context.task.design && !context.task.review && !context.task.assessmentOnly && context.task.approval),
    "Only Agent and approved Implementation roles may execute commands.");
    context.signal.throwIfAborted(); context.validatePaths();
  });
  const tool = (name, description, parameters, execute, permission = true, validate) => ({
    name, description, parameters, requiresPermission: permission,
    ...(validate ? { validate } : {}),
    paths: () => ({ reads: [], writes: [] }),
    async execute(args, context) { permitted(context); return JSON.stringify(await execute(args, context)); },
  });
  return [
    tool("run_workflow_command", "Run an existing command with explicit permission in the owned working copy; return real exit status and bounded output. Arguments are passed without shell interpolation. Generated outputs may be produced; this is not an OS sandbox.",
      { type: "object", additionalProperties: false, required: ["command", "args"], properties: { command: properties.command, args: properties.args, cwd: properties.cwd, purpose: properties.purpose } },
      (args, context) => runner.run(args, context), true, (args) => runner.validateCommand(args)),
    tool("start_workflow_app", "Launch an existing app with explicit permission and keep its process owned after this task ends. Use {port} and {dataDirectory} in arguments when needed. HOST, PORT and LIVING_CANVAS_DATA_DIR are provided. Report running only after the loopback URL responds.",
      { type: "object", additionalProperties: false, required: ["command", "args"], properties },
      (args, context) => runner.start(args, context), true, (args) => runner.validateCommand(args)),
    tool("read_workflow_apps", "Read this runtime's owned command/app statuses and bounded output; never adopt or restart a process.",
      { type: "object", additionalProperties: false, properties: {} }, () => runner.read(), false),
    tool("stop_workflow_app", "Stop only an app or command with a live handle owned by this runtime. Arbitrary OS process IDs are not accepted.",
      { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", minLength: 1 } } },
      ({ id }) => runner.stop(id)),
  ];
}

export function humanLoopCommandTools(runner, policy) {
  return workflowCommandTools(runner, policy, { authorize: (context) => {
    requireCondition(context.task.schemaVersion === "human-loop-task/v1"
      && ["agent", "implementer", "reviewer"].includes(context.task.binding.role),
    "Only the current read-only Agent, internally accepted Implementation or whole-plan Reviewer may run permitted commands.");
    if (context.task.binding.role === "implementer") requireCondition(context.task.context.acceptance?.authority === "host",
      "Implementation command has no Host internal-plan acceptance.");
    context.signal.throwIfAborted(); context.validatePaths();
  } }).map((tool) => ({
    ...tool,
    roles: tool.name === "read_workflow_apps" ? ["agent", "implementer", "reviewer"] : ["agent", "implementer"],
    async execute(args, context) {
      requireCondition(context.task.binding.role !== "reviewer" || tool.name === "read_workflow_apps",
        "Reviewer may inspect retained process evidence but may not execute commands or control apps.");
      return tool.execute(args, context);
    },
  }));
}
