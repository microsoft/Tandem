import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isApplicationHeader, isHeaderMessage, type ApplicationHeader, type HeaderAction } from "../renderer/standalone-header.js";

export function useEmbeddedHeader(canvasUrl: string | null | undefined, generation: string | undefined, reload: number, report: (error: string, dismissible?: boolean) => void) {
    const frame = useRef<HTMLIFrameElement>(null);
    const channel = useMemo(() => crypto.randomUUID(), [canvasUrl, generation, reload]);
    const [received, setReceived] = useState<{ channel: string; header: ApplicationHeader } | null>(null);
    const header = received?.channel === channel ? received.header : null;
    const origin = canvasUrl ? new URL(canvasUrl).origin : null;
    const connect = useCallback(() => {
        if (origin) frame.current?.contentWindow?.postMessage({ type: "tandem:header:connect", channel }, origin);
    }, [channel, origin]);
    useEffect(() => {
        if (!origin) return;
        const receive = (event: MessageEvent<unknown>) => {
            if (event.source !== frame.current?.contentWindow || event.origin !== origin || !isHeaderMessage(event.data, channel)) return;
            if (event.data.type === "tandem:header:ready") connect();
            else if (event.data.type === "tandem:header:unavailable") setReceived(null);
            else if (event.data.type === "tandem:header:state") {
                if (isApplicationHeader(event.data.header)) setReceived({ channel, header: event.data.header });
                else {
                    setReceived(null);
                    frame.current?.contentWindow?.postMessage({ type: "tandem:header:disconnect", channel }, origin);
                    report("The application returned invalid header controls. Its original controls remain available; reload the page to reconnect.", false);
                }
            } else if (event.data.type === "tandem:header:error" && typeof event.data.message === "string") {
                report(event.data.message.slice(0, 8192));
            }
        };
        window.addEventListener("message", receive);
        return () => window.removeEventListener("message", receive);
    }, [channel, origin, connect, report]);
    const send = (action: HeaderAction) => {
        if (!origin || !header || !frame.current?.contentWindow || !header.controls[action] || header.controls[action]?.disabled) {
            report("The application is not ready for that action. Wait for it to reconnect.", false);
            return;
        }
        frame.current.contentWindow.postMessage({ type: "tandem:header:action", channel, scope: header.scope, action }, origin);
    };
    const src = canvasUrl ? `${canvasUrl}#${new URLSearchParams({ "tandem-host": window.location.origin, "header-channel": channel })}` : undefined;
    return { frame, src, header, send, onLoad: () => { setReceived(null); connect(); } };
}
