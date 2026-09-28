import { useEffect, useMemo, useRef, useState } from "react";

export const headerActions = ["reload", "reset", "signIn", "cancelSignIn"] as const;
export type HeaderAction = typeof headerActions[number];
export interface HeaderControl {
  label: string;
  title: string;
  disabled: boolean;
  busy: boolean;
}
export interface ApplicationHeader {
  scope: string;
  version: string;
  lifecycle: string;
  permissionScope?: "main" | "development";
  controls: Record<HeaderAction, HeaderControl | null>;
  messages: Array<{ id: string; text: string; error: boolean }>;
}
interface HeaderHost { origin: string; channel: string }

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.length <= limit;

export function isApplicationHeader(value: unknown): value is ApplicationHeader {
  if (!record(value) || !text(value.scope, 1024) || !value.scope || !text(value.version, 100)
    || (value.permissionScope !== undefined && !["main", "development"].includes(String(value.permissionScope)))
    || !text(value.lifecycle, 256) || !record(value.controls) || !Array.isArray(value.messages) || value.messages.length > 8) return false;
  const controls = value.controls;
  return headerActions.every((action) => {
    const control = controls[action];
    return control === null || (record(control) && text(control.label, 100) && text(control.title, 2000)
      && typeof control.disabled === "boolean" && typeof control.busy === "boolean");
  }) && value.messages.every((message) => record(message) && text(message.id, 100)
    && text(message.text, 8192) && typeof message.error === "boolean");
}

export function standaloneHeaderHost(hash: string): HeaderHost | null {
  const params = new URLSearchParams(hash.slice(1));
  const origin = params.get("tandem-host");
  const channel = params.get("header-channel");
  if (!origin || !channel || !/^[a-f0-9-]{36}$/i.test(channel)) return null;
  try {
    const url = new URL(origin);
    return url.origin === origin && url.protocol === "http:" && url.hostname === "127.0.0.1" && Number(url.port) > 0
      ? { origin, channel } : null;
  } catch { return null; }
}

export function isHeaderMessage(value: unknown, channel: string): value is Record<string, unknown> {
  return record(value) && value.channel === channel;
}

export function useStandaloneHeader(
  state: ApplicationHeader,
  actions: Record<HeaderAction, () => void | Promise<void>>,
): boolean {
  const host = useMemo(() => window.parent !== window ? standaloneHeaderHost(window.location.hash) : null, []);
  const [hosted, setHosted] = useState(false);
  const current = useRef({ state, actions, hosted });
  current.current = { state, actions, hosted };
  const serialized = JSON.stringify(state);
  useEffect(() => {
    if (!host) return;
    const post = (value: Record<string, unknown>) => window.parent.postMessage({ ...value, channel: host.channel }, host.origin);
    const publish = () => post({ type: "tandem:header:state", header: current.current.state });
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== window.parent || event.origin !== host.origin || !isHeaderMessage(event.data, host.channel)) return;
      if (event.data.type === "tandem:header:connect") {
        current.current.hosted = true;
        setHosted(true);
        publish();
        return;
      }
      if (event.data.type === "tandem:header:disconnect") {
        current.current.hosted = false;
        setHosted(false);
        return;
      }
      if (event.data.type !== "tandem:header:action" || !current.current.hosted) return;
      const requestedAction = event.data.action;
      const action = headerActions.find((action) => action === requestedAction);
      if (!action || event.data.scope !== current.current.state.scope || !current.current.state.controls[action]
        || current.current.state.controls[action]?.disabled) {
        post({ type: "tandem:header:error", message: "This action is no longer available. Review the current workspace before retrying." });
        publish();
        return;
      }
      const invoke = async () => current.current.actions[action]();
      void invoke().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "The application header action failed.";
        console.error("Standalone header action failed.", error);
        post({ type: "tandem:header:error", message });
      });
    };
    window.addEventListener("message", receive);
    post({ type: "tandem:header:ready" });
    return () => {
      window.removeEventListener("message", receive);
      post({ type: "tandem:header:unavailable" });
    };
  }, [host]);
  useEffect(() => {
    if (host && hosted) window.parent.postMessage({ type: "tandem:header:state", channel: host.channel, header: JSON.parse(serialized) }, host.origin);
  }, [host, hosted, serialized]);
  return hosted;
}
