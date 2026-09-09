import type { IncomingMessage } from "node:http";

const speechScope = "https://cognitiveservices.azure.com/.default";
const identityTimeoutMs = 15_000;
const minimumTokenLifetimeMs = 180_000;

export class SpeechAuthError extends Error {
    constructor(message: string, public readonly statusCode: number) {
        super(message);
        this.name = "SpeechAuthError";
    }
}

export interface SpeechToken {
    authorizationToken: string;
    region: string;
    language: string;
    /** Unix timestamp in milliseconds, matching Azure Identity's expiresOnTimestamp. */
    expiresAt: number;
}

export interface SpeechCredential {
    getToken(
        scope: string,
        options: { abortSignal: AbortSignal },
    ): Promise<{ token: string; expiresOnTimestamp: number } | null>;
}

export interface SpeechTokenServiceDependencies {
    env?: Readonly<Record<string, string | undefined>>;
    createCredential?: () => SpeechCredential | Promise<SpeechCredential>;
    now?: () => number;
}

function readConfiguration(env: Readonly<Record<string, string | undefined>>) {
    const resourceId = env.TANDEM_Speech__ResourceId;
    const region = env.TANDEM_Speech__Region;
    const language = env.TANDEM_Speech__Language || "en-US";
    if (!resourceId || !region) {
        throw new SpeechAuthError(
            "Configure TANDEM_Speech__ResourceId and TANDEM_Speech__Region for an Azure Speech resource, then restart Tandem. Subscription keys are not used.",
            503,
        );
    }
    const resourceIdPattern = /^\/subscriptions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/resourceGroups\/[a-z0-9_.()-]{0,89}[a-z0-9_()-]\/providers\/Microsoft\.CognitiveServices\/accounts\/[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/i;
    if (!resourceIdPattern.test(resourceId) || /[\r\n]/.test(resourceId)) {
        throw new SpeechAuthError(
            "TANDEM_Speech__ResourceId must be the Azure Cognitive Services account ARM ID: /subscriptions/<subscription-guid>/resourceGroups/<group>/providers/Microsoft.CognitiveServices/accounts/<account>.",
            503,
        );
    }
    if (!/^[a-z][a-z0-9]{1,31}$/.test(region) || /[\r\n]/.test(region)) {
        throw new SpeechAuthError(
            "TANDEM_Speech__Region must be a lowercase Azure region identifier, such as eastus or westus2, not an endpoint URL.",
            503,
        );
    }
    if (!/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?-(?:[A-Z]{2}|[0-9]{3})$/.test(language) || /[\r\n]/.test(language)) {
        throw new SpeechAuthError(
            "TANDEM_Speech__Language must be an Azure Speech locale such as en-US, zh-TW, or sr-Latn-RS; omit it to use en-US.",
            503,
        );
    }
    return { resourceId, region, language };
}

export function createSpeechTokenService(
    deps: SpeechTokenServiceDependencies = {},
): () => Promise<SpeechToken> {
    const env = deps.env ?? process.env;
    const now = deps.now ?? Date.now;
    const createCredential = deps.createCredential
        ?? (async () => {
            const { DefaultAzureCredential } = await import("@azure/identity");
            // JavaScript DefaultAzureCredential excludes InteractiveBrowserCredential by default.
            return new DefaultAzureCredential({ processTimeoutInMs: identityTimeoutMs });
        });
    let credential: Promise<SpeechCredential> | undefined;

    return async function getToken(): Promise<SpeechToken> {
        const { resourceId, region, language } = readConfiguration(env);
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                reject(new Error("Azure identity deadline exceeded."));
                controller.abort();
            }, identityTimeoutMs);
        });
        let accessToken: Awaited<ReturnType<SpeechCredential["getToken"]>>;
        try {
            accessToken = await Promise.race([
                Promise.resolve().then(async () => {
                    controller.signal.throwIfAborted();
                    credential ??= Promise.resolve().then(createCredential).catch((error) => {
                        credential = undefined;
                        throw error;
                    });
                    const currentCredential = await credential;
                    controller.signal.throwIfAborted();
                    return currentCredential.getToken(speechScope, { abortSignal: controller.signal });
                }),
                deadline,
            ]);
        } catch {
            if (controller.signal.aborted) {
                throw new SpeechAuthError(
                    "Azure Speech Entra authentication timed out. Check connectivity and sign in with az login in the resource's tenant, then retry.",
                    504,
                );
            }
            // Do not retain a cause: identity errors can include credentials and process output.
            throw new SpeechAuthError(
                "Azure Speech Entra authentication failed. Sign in with az login in the resource's tenant, or configure a supported DefaultAzureCredential identity. Ensure that identity has the Cognitive Services Speech User role on the configured resource, then retry.",
                503,
            );
        } finally {
            clearTimeout(timer);
        }
        if (
            !accessToken
            || typeof accessToken.token !== "string"
            || accessToken.token.length > 32_768
            || !/^[A-Za-z0-9._~+/-]+=*$/.test(accessToken.token)
            || /[\r\n]/.test(accessToken.token)
            || !Number.isFinite(accessToken.expiresOnTimestamp)
            || accessToken.expiresOnTimestamp <= now() + minimumTokenLifetimeMs
        ) {
            throw new SpeechAuthError(
                "Azure Speech received an invalid or nearly expired Entra token. Sign in again with az login and retry; check the system clock if the problem persists.",
                502,
            );
        }
        return {
            authorizationToken: `aad#${resourceId}#${accessToken.token}`,
            region,
            language,
            expiresAt: accessToken.expiresOnTimestamp,
        };
    };
}

export function validateSpeechTokenRequest(req: IncomingMessage, expectedOrigin: string): void {
    let origin: URL;
    try {
        origin = new URL(expectedOrigin);
        if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== expectedOrigin) {
            throw new Error("Invalid origin.");
        }
    } catch {
        throw new SpeechAuthError("The speech endpoint origin is not configured correctly.", 500);
    }
    if (req.method !== "POST") {
        throw new SpeechAuthError("The speech token endpoint requires POST.", 405);
    }
    const guardedHeaders = ["host", "origin", "sec-fetch-site", "x-tandem-speech", "content-type"];
    for (const name of guardedHeaders) {
        const value = req.headers[name];
        const occurrences = (req.rawHeaders ?? []).filter((header, index) =>
            index % 2 === 0 && header.toLowerCase() === name).length;
        if (occurrences > 1 || Array.isArray(value) || (value !== undefined && /[\r\n\0]/.test(value))) {
            throw new SpeechAuthError("The speech token request contains ambiguous headers.", 403);
        }
    }
    if (
        req.headers.host !== origin.host
        || (req.headers.origin !== undefined && req.headers.origin !== expectedOrigin)
        || (req.headers["sec-fetch-site"] !== undefined
            && !["same-origin", "none"].includes(req.headers["sec-fetch-site"] as string))
        || req.headers["x-tandem-speech"] !== "1"
    ) {
        throw new SpeechAuthError("Speech tokens may only be requested by the same-origin Tandem canvas.", 403);
    }
    if (!/^application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:utf-8|"utf-8"))?$/i.test(req.headers["content-type"] ?? "")) {
        throw new SpeechAuthError("The speech token endpoint requires Content-Type: application/json.", 415);
    }
}
