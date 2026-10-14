import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

export async function openProjectFolder(workspacePath, {
  platform = process.platform, systemRoot = process.env.SystemRoot, launch = spawn,
} = {}) {
  if (platform !== "win32") throw new Error("Opening the project folder is currently supported on Windows only.");
  if (typeof systemRoot !== "string" || !isAbsolute(systemRoot)) throw new Error("The Windows Explorer installation path is unavailable.");
  const target = resolve(workspacePath), entry = await lstat(target);
  if (!entry.isDirectory() || entry.isSymbolicLink() || (await realpath(target)).toLowerCase() !== target.toLowerCase()) {
    throw new Error("The bound project folder is missing or aliased; no other folder was opened.");
  }
  const executable = join(systemRoot, "explorer.exe");
  await new Promise((accept, reject) => {
    const child = launch(executable, [target], { shell: false, windowsHide: false, stdio: "ignore" });
    child.once("error", (error) => reject(new Error(`Explorer launch failed: ${error.message}`, { cause: error })));
    child.once("spawn", () => { child.unref(); accept(); });
  });
  return { requested: true, path: target };
}
