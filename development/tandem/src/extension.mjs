import { createCanvas, defineWorkflow, joinSession } from "@github/copilot-sdk/extension";
import { createHumanLoopController } from "./human-loop-controller.mjs";
import { openBrowserCanvas } from "./browser-navigation.mjs";
import { createBrowserEntry } from "./human-loop-browser-entry.mjs";
import { privateReviewRegistration } from "./native-evidence-workflow.mjs";

let session;
const privateRegistration = privateReviewRegistration(defineWorkflow, () => session);
if (privateRegistration) {
  session = await joinSession(privateRegistration);
} else {
const controller = createHumanLoopController({
  workspacePath: process.cwd(), sdkModulePath: import.meta.resolve("@github/copilot-sdk"),
});
const browserEntry = createBrowserEntry({
  getSession: () => session, start: controller.start,
  createProvider: () => controller.openView("browser", { surface: "browser" }),
  reportError: controller.reportError,
});
const canvas = createCanvas({
  id: "tandem", displayName: "Tandem",
  description: "Project Design, implementation and whole-plan Review in one working copy.",
  actions: [
    { name: "get_status", description: "Read the current one-copy workflow status without effects.", handler: controller.status },
    { name: "open_browser", description: "Get a regular-browser URL that stays available after closing this canvas panel.",
      inputSchema: browserEntry.tool.parameters, handler: context => browserEntry.open(context) },
  ],
  open: async context => {
    const provider = await controller.openView(context.instanceId, {
      openBrowser: (url, options) => openBrowserCanvas(session, url, options),
    });
    void controller.start().catch(controller.reportError);
    return { url: provider.url };
  },
  onClose: context => controller.closeView(context.instanceId),
});
session = await joinSession({
  canvases: [canvas], tools: [browserEntry.tool],
  hooks: { onPreToolUse: controller.toolHook, onSessionEnd: async (input, invocation) => {
    if (input.reason !== "user_exit" || invocation.sessionId !== session?.sessionId) return;
    try { await controller.close(); } finally { await browserEntry.close(); }
  } },
  onPermissionRequest: controller.permissionHandler,
  onEvent: controller.observe,
});
await controller.attach(session);
}
