export interface DevelopmentStatus {
  kind: "attention" | "active" | "acknowledgement" | "idle";
  text: string;
  requestId: string | null;
}
export function validDevelopmentStatus(value: unknown): value is DevelopmentStatus;
export function developmentStartup(snapshot: unknown): "starting" | "verifying" | null;
export function developmentStatus(snapshot: unknown, acknowledgement?: unknown): DevelopmentStatus;
