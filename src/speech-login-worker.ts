import { parentPort, workerData } from "node:worker_threads";
import { InteractiveBrowserCredential } from "@azure/identity";
import type { SpeechBrowserOptions } from "./speech-auth.js";

const options: SpeechBrowserOptions = workerData;
const credential = new InteractiveBrowserCredential({
    tenantId: options.tenantId,
    clientId: options.clientId,
    disableAutomaticAuthentication: true,
    browserCustomizationOptions: {
        successMessage: "<!doctype html><title>Tandem sign-in</title><h1>Microsoft sign-in returned to Tandem</h1><p>You can close this tab. Return to Tandem for the final sign-in status.</p>",
        errorMessage: "<!doctype html><title>Tandem sign-in</title><h1>Sign-in did not complete</h1><p>Return to Tandem and select Sign in with Microsoft to retry.</p>",
    },
});
if (!parentPort) throw new Error("Speech login must run in its dedicated worker.");
const port = parentPort;
port.on("message", async (request: { id: number; action: string; scope: string }) => {
    try {
        if (request.scope !== "https://cognitiveservices.azure.com/.default"
            || !["authenticate", "getToken"].includes(request.action)) {
            throw new Error("Invalid speech authentication request.");
        }
        if (request.action === "authenticate") await credential.authenticate(request.scope);
        const token = await credential.getToken(request.scope);
        port.postMessage({ id: request.id, ok: true, token });
    } catch {
        // Never send identity exceptions, auth records, or SDK process output to the UI.
        port.postMessage({ id: request.id, ok: false });
    }
});
