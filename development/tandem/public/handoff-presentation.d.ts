export interface HandoffDesign { revisionId: string; digest: string }
export interface HandoffActivity {
  requestId: string;
  label: string;
  active?: boolean;
  quietDesign?: HandoffDesign | null;
  statusKind?: "progress" | "attention" | "settled";
  statusText?: string;
}
export function validHandoffDesign(value: unknown): value is HandoffDesign;
export function validHandoffActivity(value: unknown): value is HandoffActivity;
export function quietHandoff(activity: HandoffActivity | null | undefined, displayedDesign: HandoffDesign | null | undefined, permissions?: number): boolean;
export function handoffProgress(activity: HandoffActivity | null | undefined, displayedDesign: HandoffDesign | null | undefined, permissions?: number): string;
export function currentHandoffActivity(activities: HandoffActivity[] | null | undefined, requestId?: string | null): HandoffActivity | null;
