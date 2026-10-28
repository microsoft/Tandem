import type { CopilotSession } from "@github/copilot-sdk";

export interface MainModelSettings {
  sessionId: string | null;
  actual: string | null;
  reasoningEffort: string | null;
  models: Array<{ id: string; name: string; supportedReasoningEfforts: string[] }>;
  canChange: boolean;
  error: string | null;
  sharedEffort: string | null;
  reason: string;
}
export class MainSessionModel {
  constructor(session: () => CopilotSession | undefined, effort: () => Promise<string | null>);
  read(): Promise<MainModelSettings>;
  select(input: { model: string; sessionId: string; expectedModel: string | null }): Promise<MainModelSettings>;
  initializeDefault(): Promise<void>;
}
export function initializeMainSessionModel(session: CopilotSession): Promise<void>;
