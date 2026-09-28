import type { CopilotSession, SessionConfig } from "@github/copilot-sdk";
import type { HumanLoopState, Handoff, WorkCycle, RequestRecord } from "../runtime-types/domain/human-loop/model.js";
import type { HumanRequest, HumanRole, DesignBinding, SnapshotRef } from "../runtime-types/domain/human-loop/contracts.js";

export interface HumanLoopRuntimeHandle {
  sessionId: string;
  store: { load(): Promise<HumanLoopState> };
  send(request: HumanRequest): Promise<HumanRequest>;
  readiness(): Promise<{ status: string; reason?: string | null }>;
  transport: { inspectIdle(): Promise<unknown> };
  workspace: { capture(): Promise<SnapshotRef>; verifySnapshot(ref: SnapshotRef): Promise<unknown> };
  currentDesign(): Promise<{ binding: DesignBinding; content: unknown }>;
  commands: { evidenceForCycle(cycleId: string | null): Promise<unknown[]> };
}
export interface HumanLoopController {
  toolHook: NonNullable<NonNullable<SessionConfig["hooks"]>["onPreToolUse"]>;
  permissionHandler: NonNullable<SessionConfig["onPermissionRequest"]>;
  observe: NonNullable<SessionConfig["onEvent"]>;
  attach(session: CopilotSession): Promise<void>;
  start(options?: { retry?: boolean }): Promise<HumanLoopRuntimeHandle>;
  openView(id: string, options?: { surface?: "browser" }): Promise<{ url: string; close(): Promise<void> }>;
  closeView(id: string): Promise<void>;
  assertQuiet(): Promise<void>;
  close(): Promise<{ status: string; warnings: string[] }>;
  status(): Promise<{ installation: { status: string; reason?: string | null }; workflow: { status: string; reason?: string | null } | null }>;
  reportError(error: Error): void;
  installation?: { runtime: HumanLoopRuntimeHandle | null; configuration: { owner: HumanLoopState["owner"] } | null };
}
export function createHumanLoopController(options: {
  workspacePath: string;
  sdkModulePath: string;
  cliPath?: string;
  nodePath?: string;
  runtimeRoot?: string;
  mainPermissionHandler?: NonNullable<SessionConfig["onPermissionRequest"]>;
  withRequestAdmission?<T>(operation: () => Promise<T>): Promise<T>;
  beforeStart?(): Promise<void>;
  contextProvider?(input: { role: HumanRole; request: RequestRecord; cycle: WorkCycle | null; state: HumanLoopState }): Promise<unknown>;
  onHandoff?(handoff: Handoff): Promise<void>;
}): HumanLoopController;
export function createDurablePrivateSession(
  client: import("@github/copilot-sdk").CopilotClient, configuration: SessionConfig,
): Promise<CopilotSession>;
