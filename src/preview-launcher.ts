import { spawn, execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { launchDigest, requireFreePreviewPort, verifyLaunchRecipe, type PreviewLaunchRecipe } from "./preview-launch.js";
import { writeJsonAtomically } from "./project-store.js";

async function main() {
    const [path, digest] = process.argv.slice(2);
    if (!path || !digest) throw new Error("The reviewed preview launch manifest is required.");
    const manifest = JSON.parse(await readFile(path, "utf8")) as { version: number; launchId: string; recipe: PreviewLaunchRecipe };
    if (manifest.version !== 1 || launchDigest(manifest) !== digest || !/^[a-f0-9-]{36}$/.test(manifest.launchId)) {
        throw new Error("Preview launch manifest changed after native permission was requested.");
    }
    const receipt = join(dirname(path), "process.json"), recipe = manifest.recipe;
    let child: ReturnType<typeof spawn> | undefined, timer: ReturnType<typeof setInterval> | undefined;
    let checking = false, stopped = false;
    const startedAt = new Date().toISOString();
    const record = (status: string, error?: string) => writeJsonAtomically(receipt, {
        version: 1, launchId: manifest.launchId, status, wrapperPid: process.pid, pid: child?.pid ?? null,
        startedAt, executable: recipe.executable, args: recipe.args, cwd: recipe.cwd, url: recipe.url, ...(error ? { error } : {}),
    });
    try {
        if (process.platform !== "win32") throw new Error("This restart adapter requires native Windows PowerShell process/listener ownership checks.");
        await verifyLaunchRecipe(recipe);
        await requireFreePreviewPort(recipe.url);
        child = spawn(recipe.executable, recipe.args, { cwd: recipe.cwd, shell: false, windowsHide: true, stdio: "inherit" });
        await new Promise<void>((resolve, reject) => { child!.once("spawn", resolve); child!.once("error", reject); });
        await record("starting");
        child.once("exit", (code, signal) => {
            stopped = true;
            if (timer) clearInterval(timer);
            void record("exited", `Exit ${code ?? signal}`).then(() => { process.exitCode = code === 0 ? 0 : 1; });
        });
        timer = setInterval(() => { void (async () => {
            if (checking || stopped) return;
            checking = true;
            try {
                const port = Number(new URL(recipe.url).port);
                const command = `$p=Get-CimInstance Win32_Process; $ids=[System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${child!.pid}); do{$added=$false; foreach($x in $p){if($ids.Contains([int]$x.ParentProcessId) -and $ids.Add([int]$x.ProcessId)){$added=$true}}}while($added); $listeners=@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue); if($listeners.Count -eq 0){'waiting'}elseif(@($listeners|Where-Object{!$ids.Contains([int]$_.OwningProcess)}).Count){'foreign'}else{'owned'}`;
                const result = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command],
                    { windowsHide: true, timeout: 5000, maxBuffer: 65536 });
                if (stopped) return;
                const ownership = result.stdout.trim();
                if (ownership === "owned") await record("running");
                else if (ownership === "foreign") throw new Error("The saved port is owned by an unrelated process.");
                else if (ownership !== "waiting") throw new Error("Preview listener ownership could not be determined.");
            } catch (error) {
                stopped = true; clearInterval(timer);
                child!.kill();
                await record("failed", error instanceof Error ? error.message : String(error));
            } finally { checking = false; }
        })(); }, 500);
        for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
            stopped = true; if (timer) clearInterval(timer); child?.kill();
        });
    } catch (error) {
        stopped = true; if (timer) clearInterval(timer); child?.kill();
        await record("failed", error instanceof Error ? error.message : String(error));
        throw error;
    }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
