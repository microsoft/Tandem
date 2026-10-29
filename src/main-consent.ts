/** SDK-supported abstention: the creating Node client's registered broker owns main consent. */
export function nodeMainConsent(ownerSessionId: string, joinedSessionId: () => string | undefined) {
    if (!ownerSessionId) throw new Error("The Node permission owner identity is required.");
    return (_request: unknown, invocation: { sessionId: string }): { kind: "no-result" } => {
        if (invocation.sessionId !== ownerSessionId || (joinedSessionId() && joinedSessionId() !== ownerSessionId)) {
            throw new Error("Main-session permission callback does not belong to the registered Node host.");
        }
        return { kind: "no-result" };
    };
}
