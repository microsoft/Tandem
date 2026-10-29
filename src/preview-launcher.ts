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
    let checking = false, stopped = false, stderr = "", failure: string | null = null;
    const startedAt = new Date().toISOString();
    const record = (status: string, error?: string) => writeJsonAtomically(receipt, {
        version: 1, launchId: manifest.launchId, status, wrapperPid: process.pid, pid: child?.pid ?? null,
        startedAt, executable: recipe.executable, args: recipe.args, cwd: recipe.workingDirectory ?? recipe.cwd,
        sourceRoot: recipe.cwd, url: recipe.url, environment: { PORT: new URL(recipe.url).port }, ...(error ? { error } : {}),
    });
    try {
        if (process.platform !== "win32") throw new Error("This restart adapter requires native Windows PowerShell process/listener ownership checks.");
        await verifyLaunchRecipe(recipe);
        await requireFreePreviewPort(recipe.url);
        child = spawn(recipe.executable, recipe.args, {
            cwd: recipe.workingDirectory ?? recipe.cwd,
            env: { ...process.env, PORT: new URL(recipe.url).port },
            shell: false, windowsHide: true, stdio: ["inherit", "inherit", "pipe"],
        });
        child.stderr!.setEncoding("utf8");
        child.stderr!.on("data", (text: string) => {
            stderr = (stderr + text).slice(-4000);
            process.stderr.write(text);
        });
        await new Promise<void>((resolve, reject) => { child!.once("spawn", resolve); child!.once("error", reject); });
        const starting = record("starting");
        child.once("exit", (code, signal) => {
            stopped = true;
            if (timer) clearInterval(timer);
            void starting.then(() => record(failure ? "failed" : "exited", failure ?? `Exit ${code ?? signal}${stderr.trim() ? `: ${stderr.trim()}` : ""}`))
                .then(() => { process.exitCode = failure || code !== 0 ? 1 : 0; })
                .catch(error => { console.error(error); process.exitCode = 1; });
        });
        await starting;
        if (stopped) return;
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
                failure = error instanceof Error ? error.message : String(error);
                child!.kill();
                await record("failed", failure);
            } finally { checking = false; }
        })(); }, 500);
        for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
            stopped = true; if (timer) clearInterval(timer); child?.kill();
        });
    } catch (error) {
        stopped = true; if (timer) clearInterval(timer); child?.kill();
        failure = error instanceof Error ? error.message : String(error);
        await record("failed", failure);
        throw error;
    }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
