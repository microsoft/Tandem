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
  openView(id: string, options?: { surface?: "browser"; projectHost?: { origin: string; channel: string } }): Promise<{ url: string; close(): Promise<void> }>;
  closeView(id: string): Promise<void>;
  assertQuiet(): Promise<void>;
  validateReasoningEffort(effort: string): Promise<void>;
  selectReasoningEffort(effort: string): Promise<DevelopmentEffortStatus>;
  reasoningEffortStatus(): Promise<DevelopmentEffortStatus>;
  requiresModelSelection(): Promise<boolean>;
  modelSettings(): Promise<DevelopmentModelSettings>;
  changeModel(selection: { model: string | null; reasoningEffort?: string | null; acceptActual?: boolean }): Promise<DevelopmentModelSettings | void>;
  close(): Promise<{ status: string; warnings: string[] }>;
  status(): Promise<{ installation: { status: string; reason?: string | null }; workflow: { status: string; reason?: string | null } | null }>;
  reportError(error: Error): void;
  installation?: { runtime: HumanLoopRuntimeHandle | null; configuration: { owner: HumanLoopState["owner"] } | null };
}
export interface DevelopmentEffortStatus {
  desired: string | null;
  actual: string | null;
  model: string | null;
  supported: string[];
  status: string;
  error: string | null;
}
export interface DevelopmentModelSettings {
  models: { id: string; name: string; supportedReasoningEfforts: string[] }[];
  actual: string | null;
  desired: string | null;
  pending: string | null;
  actualReasoningEffort: string | null;
  desiredReasoningEffort: string | null;
  pendingReasoningEffort: string | null;
  projectReasoningEffort: string | null;
  effortManaged: boolean;
  canSetReasoningEffort: boolean;
  canChange: boolean;
  deferred?: boolean;
  error: string | null;
  reason: string | null;
}
export function createHumanLoopController(options: {
  workspacePath: string;
  sdkModulePath: string;
  privateExtensionPath?: string;
  cliPath?: string;
  nodePath?: string;
  runtimeRoot?: string;
  mainPermissionHandler?: NonNullable<SessionConfig["onPermissionRequest"]>;
  withRequestAdmission?<T>(operation: () => Promise<T>): Promise<T>;
  withEmptyRepairExclusion?<T>(operation: () => Promise<T>): Promise<T>;
  inspectRepairAdmissions?(): Promise<unknown>;
  beforeStart?(): Promise<void>;
  projectEffortControl?: boolean;
  contextProvider?(input: { role: HumanRole; request: RequestRecord; cycle: WorkCycle | null; state: HumanLoopState }): Promise<unknown>;
  onHandoff?(handoff: Handoff): Promise<void>;
  onHandoffSettled?(handoff: Handoff): Promise<void>;
}): HumanLoopController;
export function createDurablePrivateSession(
  client: import("@github/copilot-sdk").CopilotClient, configuration: SessionConfig,
  onCreated?: (sessionId: string) => Promise<void>,
): Promise<CopilotSession>;
