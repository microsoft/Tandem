export type CanvasEventSource = 'system' | 'user' | 'copilot';

export interface CanvasEvent {
  sequence: number;
  timestamp: string;
  type: string;
  source: CanvasEventSource;
  summary: string;
  data?: unknown;
}

export type NewCanvasEvent =
  Omit<CanvasEvent, 'sequence' | 'timestamp'>
  & { timestamp?: string };
