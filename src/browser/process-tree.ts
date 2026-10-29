export interface ProcessTree {
    assign(pid: number): void;
    close(): void;
}

export async function createProcessTree(): Promise<ProcessTree> {
    if (process.platform !== "win32") {
        let pid: number | undefined;
        return {
            assign(value) { pid = value; },
            close() {
                if (!pid) return;
                try { process.kill(-pid, "SIGKILL"); }
                catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
                pid = undefined;
            },
        };
    }
    const koffi = await import("koffi");
    const kernel = koffi.load("kernel32.dll");
    const basic = koffi.struct({
        PerProcessUserTimeLimit: "int64_t", PerJobUserTimeLimit: "int64_t", LimitFlags: "uint32_t",
        MinimumWorkingSetSize: "size_t", MaximumWorkingSetSize: "size_t", ActiveProcessLimit: "uint32_t",
        Affinity: "uintptr_t", PriorityClass: "uint32_t", SchedulingClass: "uint32_t",
    });
    const counters = koffi.struct({
        ReadOperationCount: "uint64_t", WriteOperationCount: "uint64_t", OtherOperationCount: "uint64_t",
        ReadTransferCount: "uint64_t", WriteTransferCount: "uint64_t", OtherTransferCount: "uint64_t",
    });
    const extended = koffi.struct({
        BasicLimitInformation: basic, IoInfo: counters, ProcessMemoryLimit: "size_t",
        JobMemoryLimit: "size_t", PeakProcessMemoryUsed: "size_t", PeakJobMemoryUsed: "size_t",
    });
    const createJob = kernel.func("void * __stdcall CreateJobObjectW(void *attributes, void *name)");
    const setLimits = kernel.func("__stdcall", "SetInformationJobObject", "bool",
        ["void *", "int", koffi.pointer(extended), "uint32_t"]);
    const openProcess = kernel.func("void * __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)");
    const assign = kernel.func("bool __stdcall AssignProcessToJobObject(void *job, void *process)");
    const close = kernel.func("bool __stdcall CloseHandle(void *handle)");
    const lastError = kernel.func("uint32_t __stdcall GetLastError()");
    let job: unknown = createJob(null, null);
    const failure = (action: string) => new Error(`${action} (Windows error ${lastError()}). Startup cannot proceed without owned-process cleanup.`);
    if (!job) throw failure("Could not create the backend job");
    const tree: ProcessTree = {
        assign(pid) {
            const handle: unknown = openProcess(0x0101, false, pid);
            if (!handle) throw failure("Could not open the owned backend process");
            try { if (!assign(job, handle)) throw failure("Could not contain the backend process"); }
            finally { if (!close(handle)) throw failure("Could not release the backend process handle"); }
        },
        close() {
            if (!job) return;
            if (!close(job)) throw failure("Could not close the backend cleanup job");
            job = null;
        },
    };
    const limits = {
        BasicLimitInformation: {
            PerProcessUserTimeLimit: 0, PerJobUserTimeLimit: 0, LimitFlags: 0x2000,
            MinimumWorkingSetSize: 0, MaximumWorkingSetSize: 0, ActiveProcessLimit: 0,
            Affinity: 0, PriorityClass: 0, SchedulingClass: 0,
        },
        IoInfo: { ReadOperationCount: 0, WriteOperationCount: 0, OtherOperationCount: 0,
            ReadTransferCount: 0, WriteTransferCount: 0, OtherTransferCount: 0 },
        ProcessMemoryLimit: 0, JobMemoryLimit: 0, PeakProcessMemoryUsed: 0, PeakJobMemoryUsed: 0,
    };
    if (!setLimits(job, 9, limits, koffi.sizeof(extended))) {
        const error = failure("Could not configure backend kill-on-close");
        tree.close();
        throw error;
    }
    return tree;
}
