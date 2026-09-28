import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openProjectFolder } from "../src/open-project-folder.mjs";

test("project folder launch uses the bound directory as one argument without a shell", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "project & folder-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  let unreferenced = false;
  const result = await openProjectFolder(root, { platform: "win32", systemRoot: join(root, "Windows"),
    launch: (...args) => {
      calls.push(args);
      const child = new EventEmitter();
      child.unref = () => { unreferenced = true; };
      queueMicrotask(() => child.emit("spawn"));
      return child;
    } });
  assert.deepEqual(calls, [[join(root, "Windows", "explorer.exe"), [root],
    { shell: false, windowsHide: false, stdio: "ignore" }]]);
  assert.deepEqual(result, { requested: true, path: root });
  assert.equal(unreferenced, true);
});

test("project folder launch reports missing paths, unsupported platforms and native launch failure", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "project-folder-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(openProjectFolder(root, { platform: "unsupported" }), /Windows only/);
  await assert.rejects(openProjectFolder(root, { platform: "win32", systemRoot: "relative" }), /unavailable/);
  await assert.rejects(openProjectFolder(join(root, "missing"), { platform: "win32", systemRoot: root }), /ENOENT/);
  await assert.rejects(openProjectFolder(root, { platform: "win32", systemRoot: root,
    launch: () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", new Error("Native launch denied.")));
      return child;
    } }), /Explorer launch failed: Native launch denied/);
});
