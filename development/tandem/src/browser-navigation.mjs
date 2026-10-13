import { createHash } from "node:crypto";
import { normalizeNavigationUrl } from "../public/link-navigation.js";

/** Open host UI directly for an explicit link gesture, never an agent/workflow turn. */
export async function openBrowserCanvas(session, address, { focus = true } = {}) {
  const url = normalizeNavigationUrl(address);
  if (typeof focus !== "boolean") throw new Error("Browser focus must be a boolean.");
  if (!session?.sessionId || typeof session.rpc?.canvas?.list !== "function" || typeof session.rpc?.canvas?.open !== "function") {
    throw new Error("The Host Browser canvas API is unavailable. Copy the address and open it using the Host browser controls.");
  }
  const catalog = await session.rpc.canvas.list();
  if (!Array.isArray(catalog?.canvases)) throw new Error("The Host returned an invalid canvas catalog.");
  const candidates = catalog.canvases.filter((canvas) => canvas?.canvasId === "browser");
  if (candidates.length !== 1) throw new Error(candidates.length
    ? "More than one Browser canvas is available; use the Host browser controls to choose one."
    : "The Host Browser canvas is unavailable. Copy the address and open it using the Host browser controls.");
  const browser = candidates[0];
  if (typeof browser.extensionId !== "string" || !browser.extensionId
    || browser.inputSchema?.properties?.url?.type !== "string") {
    throw new Error("The Host Browser canvas does not advertise a supported URL input.");
  }
  const placement = browser.inputSchema.properties.placement?.properties?.focus?.type === "boolean";
  if (!focus && !placement) throw new Error("This Host does not support background browser opening. Activate the link normally.");
  const instanceId = `tandem-link-${createHash("sha256").update(`${session.sessionId}\0${url}`).digest("hex").slice(0, 24)}`;
  const result = await session.rpc.canvas.open({
    extensionId: browser.extensionId, canvasId: browser.canvasId, instanceId,
    input: { url, ...(placement ? { placement: { focus } } : {}) },
  });
  if (result?.instanceId !== instanceId || result.canvasId !== "browser" || result.extensionId !== browser.extensionId) {
    throw new Error("The Host did not confirm the requested Browser canvas. Inspect the Host browser before trying again.");
  }
  return { instanceId };
}
