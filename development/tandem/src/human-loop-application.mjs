import {
  APPLICATION_PROTOCOL, ApplicationError, applicationAvailability, applicationRequest, assertApplicationAvailable,
  booleanSchema, collectApplicationReply, describeApplicationOperation, enumSchema, findApplicationOperation,
  idSchema, nullableSchema, objectSchema, readApplicationCommand, revisionSchema, stringSchema, validateApplicationInput,
} from "../runtime-src/application-interface.ts";
import { annotationLimits } from "../runtime-src/domain/workflow/annotation-attachment.ts";

const text = stringSchema(65536, 0), id = idSchema, empty = objectSchema();
const decision = objectSchema({ confirmationId: id, approve: booleanSchema }, ["confirmationId", "approve"]);
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const dimension = { type: "integer", minimum: 1, maximum: annotationLimits.maxEdge };
const annotationBase = {
  revisionId: id, selectionId: nullableSchema(id), viewport: objectSchema({
    x: revisionSchema, y: revisionSchema, width: dimension, height: dimension, scale: { const: 1 },
  }, ["x", "y", "width", "height", "scale"]),
};
const annotationSource = { oneOf: [
  objectSchema({ ...annotationBase, schemaVersion: { const: "artifact-annotation/v1" }, designDigest: hash, artifactId: id },
    ["schemaVersion", "revisionId", "designDigest", "artifactId", "selectionId", "viewport"]),
  objectSchema({ ...annotationBase, perspective: enumSchema("use-case", "contract", "flow", "gui", "system") },
    ["revisionId", "perspective", "selectionId", "viewport"]),
] };
const imageBase = {
  id: hash, sha256: hash, byteLength: { type: "integer", minimum: 1, maximum: annotationLimits.maxBytes },
  width: dimension, height: dimension,
};
const attachment = { oneOf: [
  objectSchema({ ...imageBase, schemaVersion: { const: "image-attachment/v1" }, mimeType: enumSchema("image/png", "image/jpeg") },
    ["schemaVersion", "id", "sha256", "mimeType", "byteLength", "width", "height"]),
  objectSchema({ ...imageBase, mimeType: { const: "image/png" }, source: annotationSource },
    ["id", "sha256", "mimeType", "byteLength", "width", "height", "source"]),
] };
/** @returns {import("../runtime-src/application-interface.ts").ApplicationOperation} */
const operation = (id, method, path, description, inputSchema = empty, options = {}) => ({
  id, method, path, description, inputSchema, authority: "agent", retry: method === "GET" ? "read" : "inspect", ...options,
});
const request = {
  id, message: text, receivedAt: stringSchema(100),
  roleHint: { ...objectSchema({ schemaVersion: { const: "human-role-hint/v1" }, role: enumSchema("designer", "agent") }, ["schemaVersion", "role"]),
    description: "Must match the exact lowercase @designer or @agent mention at the start of message; routing remains native-owned." },
  attachments: { type: "array", minItems: 1, maxItems: annotationLimits.maxImages, items: attachment },
};

export const developmentOperations = [
  operation("native.state", "GET", "/api/snapshot", "Read projected native Design, plan, tasks, results, questions, confirmations and execution status."),
  operation("native.settings", "GET", "/api/settings", "Read native preferences and separate main/private model controls."),
  operation("native.host-state", "GET", "/api/host-state", "Inspect durable native storage inventory.",
    objectSchema({ after: stringSchema(200), limit: { ...revisionSchema, minimum: 1, maximum: 1000 } }), { query: ["after", "limit"] }),
  operation("native.preferences", "POST", "/api/settings", "Change display preferences without changing workflow authority.",
    objectSchema({ theme: enumSchema("system", "light", "dark"), fontSize: enumSchema("normal", "larger", "largest") }, ["theme", "fontSize"])),
  operation("native.main-model", "POST", "/api/settings/main-model", "Select the user's explicit main-session model.",
    objectSchema({ model: id, sessionId: id, expectedModel: nullableSchema(id) }, ["model", "sessionId", "expectedModel"]), { authority: "user" }),
  operation("native.model", "POST", "/api/settings/model", "Select or reconcile the user's explicit private model and effort.",
    objectSchema({ action: enumSchema("select", "accept-actual"), model: nullableSchema(id), reasoningEffort: nullableSchema(stringSchema(40)) },
      ["action", "model"]), { authority: "user" }),
  operation("native.start", "POST", "/api/runtime/start", "Open native Development without submitting or replaying a task.",
    objectSchema({ retry: booleanSchema })),
  operation("native.initial-creation.inspect", "POST", "/api/runtime/initial-creation/inspect", "Inspect recovery of unused native setup without recreating it."),
  operation("native.initial-creation.decide", "POST", "/api/runtime/initial-creation/decision", "Record the human's bound unused-setup recovery decision.", decision, { authority: "user" }),
  operation("native.empty-setup.inspect", "POST", "/api/runtime/empty-setup/inspect", "Inspect a retained empty native setup without resetting it."),
  operation("native.empty-setup.decide", "POST", "/api/runtime/empty-setup/decision", "Record the human's exact empty-setup repair decision.", decision, { authority: "user" }),
  operation("native.navigation", "POST", "/api/navigation/open", "Open a requested link through the supported host browser.",
    objectSchema({ url: stringSchema(8192), focus: booleanSchema }, ["url", "focus"])),
  operation("native.submit", "POST", "/api/requests", "Submit an explicit task to native routing. Design, internal planning, implementation and Review remain native-owned.",
    objectSchema(request, ["id", "message", "receivedAt"]), { retry: "identity" }),
  operation("native.answer", "POST", "/api/answers", "Submit the user's exact source-bound answers to published native questions.",
    objectSchema({ id, message: text, receivedAt: stringSchema(100), answers: objectSchema({
      schemaVersion: { const: "human-question-answers/v1" }, answers: { type: "array", minItems: 1, maxItems: 200,
        items: objectSchema({ questionId: id, sourceResultId: id, kind: enumSchema("option", "freeform"), value: text,
          selectedOption: objectSchema({ label: stringSchema(), implication: stringSchema(),
            resolutionTarget: enumSchema("design", "implementation") }, ["label", "implication"]) }, ["questionId", "sourceResultId", "kind", "value"]) },
    }, ["schemaVersion", "answers"]) }, ["id", "message", "receivedAt", "answers"]), { authority: "user", retry: "identity" }),
  operation("native.implementation.decide", "POST", "/api/implementation-confirmations/:confirmationId",
    "Record the human's current Design-bound implementation decision. No Planner or implementation bypass.",
    objectSchema({ confirmationId: id, decision: enumSchema("approved", "design", "cancelled") }, ["confirmationId", "decision"]),
    { pathParameters: ["confirmationId"], authority: "user", retry: "identity" }),
  operation("native.stop", "POST", "/api/stop", "Request native immediate or after-step Stop; inspect its actual outcome.",
    objectSchema({ stopId: id, mode: enumSchema("immediate", "after-step") }, ["stopId"]), { retry: "identity" }),
  operation("native.close", "POST", "/api/runtime/close", "Close the owned private runtime, reporting persistence and shutdown separately."),
  operation("native.open-folder", "POST", "/api/project/open-folder", "Reveal the current project in the host file manager."),
  operation("native.compaction.inspect", "POST", "/api/context/compaction/request", "Request the native context-compaction confirmation."),
  operation("native.compaction.decide", "POST", "/api/context/compaction/decision", "Record the user's bound compaction decision.",
    objectSchema({ requestId: id, approve: booleanSchema }, ["requestId", "approve"]), { authority: "user", retry: "identity" }),
  operation("native.permissions.reset", "POST", "/api/permissions/reset", "Reset remembered private approvals after the user's explicit decision.", empty, { authority: "user" }),
  operation("native.permissions.off", "POST", "/api/permissions/off", "Turn off automatic private approvals.", empty, { authority: "user" }),
  operation("native.permissions.once", "POST", "/api/permissions/once", "Approve the exact pending private requests once, by human decision.",
    objectSchema({ requestIds: { type: "array", items: id, minItems: 1, maxItems: 200, uniqueItems: true } }, ["requestIds"]), { authority: "user" }),
  operation("native.permissions.decide", "POST", "/api/access/:requestId", "Record the user's native permission decision for the exact invocation.",
    objectSchema({ requestId: id, decision: enumSchema("once", "session", "all", "denied") }, ["requestId", "decision"]),
    { pathParameters: ["requestId"], authority: "user" }),
  operation("native.preview.stop", "POST", "/api/apps/stop", "Stop only the identified owned application preview.",
    objectSchema({ id }, ["id"]), { retry: "identity" }),
  operation("native.image.attach", "POST", "/api/application/image", "Store a PNG or JPEG attachment under native model capability and size checks.",
    objectSchema({ mimeType: enumSchema("image/png", "image/jpeg"), data: stringSchema(Math.ceil(annotationLimits.maxBytes / 3) * 4) }, ["mimeType", "data"])),
  operation("native.annotation.attach", "POST", "/api/application/annotation", "Store an annotation bound to the exact current Design artifact.",
    objectSchema({ source: annotationSource, data: stringSchema(Math.ceil(annotationLimits.maxBytes / 3) * 4) }, ["source", "data"])),
  operation("native.attachment.read", "GET", "/api/application/attachment/:id", "Read a retained request attachment as base64 with its MIME type.",
    objectSchema({ id }, ["id"]), { pathParameters: ["id"] }),
];

export function nativeAvailability(operation, snapshot, actor, input) {
  const blockers = [];
  const workflow = snapshot?.workflow;
  if (["native.submit", "native.answer", "native.implementation.decide", "native.image.attach", "native.annotation.attach"].includes(operation.id)
    && snapshot?.installation?.status !== "ready") {
    blockers.push({ code: "native_not_ready", message: "Open and reconcile the original private runtime before submitting work." });
  }
  if (operation.id === "native.submit" && workflow && !workflow.canSend) {
    blockers.push({ code: "native_admission_blocked", message: workflow.reason || "Native Development is not accepting new requests." });
  }
  if (operation.id === "native.implementation.decide" && input &&
    !workflow?.implementationConfirmations?.some(item => item.id === input.confirmationId && item.canDecide)) {
    blockers.push({ code: "confirmation_stale", message: "Review the current native implementation confirmation." });
  }
  return applicationAvailability(operation, actor, blockers, input);
}

export function createDevelopmentApplication({ snapshot, dispatch }) {
  return {
    operations: developmentOperations,
    async inspect(input = {}, actor = "agent") {
      validateApplicationInput(input, objectSchema({ operation: stringSchema(120), input: { type: "object" } }));
      const state = await snapshot();
      const operations = input.operation ? [findApplicationOperation(developmentOperations, input.operation)] : developmentOperations;
      return { protocol: APPLICATION_PROTOCOL, owner: "development", state,
        operations: operations.map(operation => describeApplicationOperation(operation,
          nativeAvailability(operation, state, actor, input.input), Boolean(input.operation))) };
    },
    async execute(value, actor = "agent") {
      const command = readApplicationCommand(value);
      const operation = findApplicationOperation(developmentOperations, command.operation);
      const request = applicationRequest(operation, command.input);
      // Stop and Close must remain usable even when ordinary snapshot reads fail.
      const state = ["native.stop", "native.close"].includes(operation.id) ? null : await snapshot();
      assertApplicationAvailable(nativeAvailability(operation, state, actor, command.input));
      const reply = await collectApplicationReply(respond => dispatch(request, respond));
      if (reply.status >= 400) {
        const detail = reply.body && typeof reply.body === "object" ? reply.body : {};
        throw new ApplicationError(detail.code || "native_operation_failed", detail.error || "Native operation failed.", reply.status, detail);
      }
      return { protocol: APPLICATION_PROTOCOL, operation: operation.id,
        outcome: operation.method === "GET" ? "read" : "accepted", data: reply.body };
    },
  };
}
