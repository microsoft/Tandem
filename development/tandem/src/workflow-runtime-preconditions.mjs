import { execFile } from "node:child_process";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { requireCondition } from "../runtime-src/domain/workflow/validation.ts";

/** Observe Git's real inventory rules; never edit ignore files or omit state from only one inventory. */
export async function requireIgnoredApplicationState({ repositoryRoot, targetWorktreePath, policy }) {
  const statePath = resolve(repositoryRoot, ".tandem");
  const local = relative(targetWorktreePath, statePath);
  if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) return;
  const options = {
    windowsHide: true, timeout: policy.values.time.attemptMaximumMs, maxBuffer: policy.values.resources.requestBytes,
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      !/^(?:GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES)|GIT_CONFIG(?:_|$))/i.test(name))),
  };
  const run = (args) => promisify(execFile)("git", ["--no-optional-locks", "-C", targetWorktreePath,
    "-c", "core.fsmonitor=false", ...args], options);
  const pathspec = local.replaceAll("\\", "/");
  let ignored = false;
  try { await run(["check-ignore", "--quiet", "--", `${pathspec}/`]); ignored = true; }
  catch (error) { if (error.code !== 1) throw error; }
  const listed = await run(["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", pathspec]);
  requireCondition(ignored && listed.stdout.length === 0,
    `Project application state (${pathspec}/) must be ignored by Git and contain no tracked files before provisioning/activation. `
      + "Review and add a preserving .tandem/ exclusion yourself, untrack any state deliberately, then retry; no files or ignore rules were changed.");
}
