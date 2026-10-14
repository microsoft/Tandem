export function createBrowserEntry({ getSession, createProvider, start, reportError }) {
  let provider, creating, closed = false;
  const open = async invocation => {
    const session = getSession();
    if (closed || !session?.sessionId || invocation?.sessionId !== session.sessionId) {
      throw new Error("Tandem browser opening requires the exact attached foreground session.");
    }
    if (!provider) {
      creating ??= Promise.resolve().then(createProvider).then(value => {
        provider = value;
        if (!closed) void Promise.resolve().then(start).catch(reportError);
        return value;
      }).finally(() => { creating = null; });
      await creating;
    }
    if (closed) throw new Error("The owning session is closing; no browser URL remains available.");
    return { url: provider.url, setup: "starting",
      instructions: "Open this URL in your regular browser. It is independent of the canvas panel and main-chat activity. If startup fails, use the visible runtime action to retry explicitly. Closing a browser tab does not stop work. Keep this CLI session open; use Close runtime before exiting, and resume this same foreground session for retained work." };
  };
  const tool = {
    name: "tandem_open_browser",
    description: "Get this session's Tandem URL for a regular browser, independent of canvas panels. Does not open the OS browser or send project work. Keep this CLI session open; use Close runtime in Tandem before exiting.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async (args, invocation) => {
      if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length) {
        throw new Error("Tandem browser opening takes no arguments.");
      }
      return JSON.stringify(await open(invocation));
    },
  };
  return {
    tool, open,
    async close() {
      closed = true;
      await creating;
      if (provider) { const current = provider; provider = null; await current.close(); }
    },
  };
}
