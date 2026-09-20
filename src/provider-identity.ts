export interface TandemProvider {
    id: string;
    status: string;
}

export function preferredTandemProvider(providers: readonly TandemProvider[], sessionId: string): string | undefined {
    const running = new Set(providers.filter((provider) => provider.status === "running").map((provider) => provider.id));
    return ["user:tandem", "project:tandem", `session:${sessionId}:tandem`]
        .find((id) => running.has(id));
}

export function isPreferredTandemProvider(id: string, providers: readonly TandemProvider[], sessionId: string): boolean {
    const preferred = preferredTandemProvider(providers, sessionId);
    // The SDK's extension catalog qualifies session IDs; its canvas registry uses source:name.
    return id === preferred || (id === "session:tandem" && preferred === `session:${sessionId}:tandem`);
}
