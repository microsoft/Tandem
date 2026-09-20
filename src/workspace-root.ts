import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from "node:child_process";
import { basename, dirname, resolve } from "node:path";

export function resolveSharedProjectRoot(cwd = process.cwd()): string {
    const options: ExecFileSyncOptionsWithStringEncoding = {
        cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
    };
    try {
        const commonDirectory = resolve(cwd, execFileSync("git", ["rev-parse", "--git-common-dir"], options).trim());
        if (basename(commonDirectory).toLowerCase() === ".git") return dirname(commonDirectory);
        return execFileSync("git", ["rev-parse", "--show-toplevel"], options).trim() || cwd;
    } catch {
        return cwd;
    }
}
