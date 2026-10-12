import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, realpath, lstat } from "node:fs/promises";
import { resolve, relative, isAbsolute, extname, sep } from "node:path";
import { InMemoryEventStore, SqliteEventStore } from "../runtime-src/event-store.ts";
import { AnnotationAttachmentStore } from "../runtime-src/domain/workflow/annotation-attachment.ts";
import { ImageAttachmentStore, isImageAttachment, parseRequestAttachments, readRequestAttachment } from "../runtime-src/domain/workflow/image-attachment.ts";
import { humanExecutionQueue, isPriorityAnswer, hasQuestionBlockers, currentImplementationConfirmation, implementationDecisionMessage } from "../runtime-src/domain/human-loop/model.ts";
import { requireCondition, object, text } from "../runtime-src/domain/workflow/validation.ts";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { getHostStateWal } from "../runtime-src/domain/host-state-wal.ts";
import { validateArtifactAnnotationSource } from "../public/sketch/design-contract.js";
import { normalizeNavigationUrl } from "../public/link-navigation.js";
import { HumanLoopPreferences } from "./human-loop-preferences.mjs";
import { openProjectFolder } from "./open-project-folder.mjs";

export function projectHumanProgress(event) {
  return { type: `human.${event.kind}`, source: "system",
    summary: event.kind === "internal-task" ? `${event.completed}/${event.total} internal tasks reported complete.`
      : event.role ? `${event.role} role` : event.summary ?? event.kind.replaceAll("-", " "),
    data: Object.fromEntries(["requestId", "role", "cycleId", "internalTaskId", "taskId", "completed", "total", "stopId", "status", "activity"]
      .filter((key) => event[key] !== undefined).map((key) => [key, event[key]])) };
}

export class HumanLoopEvents {
  #events = new InMemoryEventStore();
  #listeners = new Set();
  #durable = false;
  get streamId() { return this.#events.streamId; }
  append(input) {
    const event = this.#events.append(input);
    for (const listener of this.#listeners) listener(event);
    return event;
  }
  subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  touch() { for (const listener of this.#listeners) listener({ type: "human.state", sequence: this.#events.listRecent(1)[0]?.sequence ?? 0 }); }
  list() { return this.#events.listRecent(500); }
  enablePersistence(root) {
    if (this.#durable) return;
    const previous = this.#events.list(), store = new SqliteEventStore(root, null);
    for (const event of previous) store.append({ type: event.type, source: event.source, summary: event.summary, data: event.data, timestamp: event.timestamp });
    this.#events = store; this.#durable = true;
  }
  close() { this.#events.close?.(); }
}

export function projectHumanCycle(cycle) {
  return {
    id: cycle.id, originRequestId: cycle.originRequestId, design: cycle.design, phase: cycle.phase,
    completed: cycle.tasks.filter(({ status }) => status === "completed").length, total: cycle.plan?.tasks.length ?? 0,
    plan: cycle.plan ? { id: cycle.plan.id, version: cycle.plan.version, digest: cycle.plan.digest, design: cycle.plan.design,
      goal: cycle.plan.goal, tasks: cycle.plan.tasks } : null,
    implementation: cycle.implementationResult?.outcome.kind === "implementation-result" ? {
      resultId: cycle.implementationResult.resultId, summary: cycle.implementationResult.outcome.summary,
      evidenceRefs: cycle.implementationResult.outcome.evidenceRefs, snapshot: cycle.current,
    } : null,
    tasks: cycle.tasks.map(task => ({ id: task.id, status: task.status,
      title: cycle.plan?.tasks.find(({ id }) => id === task.id)?.title ?? task.id })),
  };
}

export function projectHumanLoopView(state, readiness) {
  const latest = state.handoffs.at(-1);
  const published = new Set(state.handoffs.filter(h => h.presented).map(h => h.result.resultId));
  const questions = state.questions.filter(q => published.has(q.source.resultId)).map((q) => ({
    id: q.id, context: q.context, question: q.question, whyItMatters: q.whyItMatters, importance: q.importance,
    options: q.options.map((option) => ({ ...option })), allowFreeform: q.allowFreeform,
    state: q.state, answerRequestId: q.answerRequestId, blockingActive: q.blockingActive,
    processingState: q.answerRequestId ? state.requests.find(r => r.id === q.answerRequestId)?.status ?? null : null,
    ...(q.invalidation ? { invalidation: q.invalidation } : {}),
    designRefs: q.designRefs ?? [],
    source: { role: q.source.role, resultId: q.source.resultId, requestId: q.source.requestId, requestIds: q.source.requestIds,
      cycleId: q.source.cycleId, design: q.source.design, planDigest: q.source.planDigest },
  }));
  const cycleId = state.activeTask?.binding.cycleId ?? state.requests.find(r => r.id === state.activeRequestId)?.route?.cycleId;
  const cycle = state.cycles.find(({ id }) => id === cycleId) ?? state.cycles.at(-1);
  const permitted = !["closed", "execution-unknown", "stopping", "presentation-pending"].includes(readiness.status);
  const groups = new Map();
  for (const question of questions) {
    const group = groups.get(question.source.resultId) ?? { resultId: question.source.resultId,
      source: question.source, questions: [], canAnswer: false };
    group.questions.push(question);
    group.canAnswer ||= permitted && question.state === "open";
    groups.set(group.resultId, group);
  }
  const questionInteractions = [...groups.values()].sort((a, b) => Number(b.questions.some(q => q.state === "open" && q.blockingActive))
    - Number(a.questions.some(q => q.state === "open" && q.blockingActive)));
  const queue = humanExecutionQueue(state);
  const sourceTask = latest && state.executions.find(({ result }) => result?.resultId === latest.result.resultId);
  const sourceRole = sourceTask?.binding.role;
  const lastStop = state.stops.at(-1);
  return {
    schemaVersion: "human-loop-view/v1", status: readiness.status, reason: readiness.reason,
    compaction: readiness.compaction,
    canResetApprovals: readiness.canResetApprovals === true,
    activeRequestId: state.activeRequestId, activeRole: state.activeTask?.binding.role ?? null,
    stop: state.stop ? { id: state.stop.id, mode: state.stop.mode ?? "immediate", taskId: state.stop.taskId } : null,
    lastStop: lastStop ? { id: lastStop.id, mode: lastStop.mode ?? "immediate", taskId: lastStop.taskId,
      invalidatedQuestions: state.questions.filter((question) => question.invalidation?.stopId === lastStop.id).map((question) => ({
        id: question.id, source: question.source, question: question.question, reason: question.invalidation.reason,
      })) } : null,
    workspacePath: readiness.workspacePath,
    implementationConfirmations: (state.implementationConfirmations ?? []).map(confirmation => {
      const request = state.requests.find(r => r.id === confirmation.requestId);
      return { ...confirmation, summary: request.route.outcome.summary, message: implementationDecisionMessage(confirmation),
        requests: confirmation.requestIds.map(id => ({ id, message: state.requests.find(r => r.id === id).message })),
        canDecide: permitted && !state.stop && !state.uncertainty && !readiness.modelBlocked
          && currentImplementationConfirmation(state)?.id === confirmation.id && confirmation.status === "pending" };
    }),
    currentCycle: cycle ? projectHumanCycle(cycle) : null,
    questionInteractions,
    questionCounts: { unanswered: questions.filter(q => q.state === "open").length,
      blockers: questions.filter(q => q.state === "open" && q.blockingActive).length,
      processing: state.requests.filter(r => isPriorityAnswer(r) && ["waiting", "active", "handoff-pending"].includes(r.status)).length },
    queue: queue.map((request) => ({
      id: request.id, message: request.message, status: request.status, kind: request.answers ? "answer" : "ordinary",
      priority: isPriorityAnswer(request),
    })),
    lastHandoff: latest ? { id: latest.id, role: sourceRole ?? "host", kind: latest.result.outcome.kind,
      summary: latest.result.outcome.summary, findings: latest.result.outcome.findings ?? [],
      ...(latest.result.outcome.reviewFormat ? { reviewFormat: latest.result.outcome.reviewFormat } : {}),
      ...(latest.result.outcome.coverageStatus ? { coverageStatus: latest.result.outcome.coverageStatus } : {}),
      verificationLimits: latest.result.outcome.verificationLimits ?? [],
      design: latest.result.outcome.kind === "designer-changed" ? state.design : sourceTask?.binding.design ?? null,
      designRefs: latest.result.outcome.designRefs ?? [] } : null,
    canStop: permitted && Boolean(state.activeRequestId || hasQuestionBlockers(state) || queue.length),
    canStopNow: (permitted || readiness.status === "stopping" && state.stop?.mode === "after-step")
      && Boolean(state.activeRequestId || hasQuestionBlockers(state) || queue.length || state.stop),
    canSend: permitted && !readiness.modelBlocked && !readiness.compaction?.requested,
  };
}

export function projectHumanConversation(state, originals) {
  const historicalQuestions = new Map();
  for (const question of state.questions) {
    const group = historicalQuestions.get(question.source.resultId) ?? [];
    group.push({ id: question.id, resultId: question.source.resultId, role: question.source.role,
      question: question.question, context: question.context, whyItMatters: question.whyItMatters,
      importance: question.importance, options: question.options, design: question.source.design,
      state: question.state, blockingActive: question.blockingActive,
      processingState: question.answerRequestId ? state.requests.find(r => r.id === question.answerRequestId)?.status ?? null : null,
      designRefs: question.designRefs ?? [] });
    historicalQuestions.set(question.source.resultId, group);
  }
  const handoffs = new Map(state.handoffs.map((handoff) => [handoff.id, handoff.result.resultId]));
  const requests = state.requests.map((request) => ({
    id: `request:${request.id}`, kind: "user", requestId: request.id, text: request.message,
    timestamp: request.receivedAt, queueState: request.status, stopId: request.stopId,
    ...(request.attachments ? { attachments: request.attachments } : {}),
    ...(request.answers ? { answerDetails: request.answers.answers.map((answer) => {
      const question = state.questions.find((q) => q.id === answer.questionId && q.source.resultId === answer.sourceResultId);
      return { questionId: answer.questionId, sourceResultId: answer.sourceResultId,
        question: question?.question ?? `Question ${answer.questionId} (saved source unavailable)`,
        role: question?.source.role ?? "unknown",
        design: question?.source.design ?? null, designRefs: question?.designRefs ?? [],
        answer: answer.kind === "option"
          ? answer.selectedOption?.label ?? question?.options.find(({ id }) => id === answer.value)?.label ?? answer.value : answer.value,
        ...(answer.selectedOption ? { implication: answer.selectedOption.implication,
          ...(answer.selectedOption.resolutionTarget ? { resolutionTarget: answer.selectedOption.resolutionTarget } : {}) } : {}) };
    }) } : {}),
  }));
  const messages = originals.filter(({ role }) => role !== "host-user").map((entry) => ({
    id: entry.id, kind: entry.kind, role: entry.role, requestId: entry.requestId, text: entry.content, timestamp: entry.timestamp,
    ...(historicalQuestions.has(handoffs.get(entry.id)) ? { questionHistory: historicalQuestions.get(handoffs.get(entry.id)) } : {}),
  }));
  for (const [resultId, questionHistory] of historicalQuestions) {
    if (messages.some((entry) => handoffs.get(entry.id) === resultId)) continue;
    const question = state.questions.find(entry => entry.source.resultId === resultId);
    const recovery = (state.recoveries ?? []).find(r => r.requestIds.includes(question?.source.requestId)
      || r.cycleIds.includes(question?.source.cycleId));
    if (recovery) messages.push({ id: `recovered-questions:${resultId}`, kind: "status", role: "host",
      requestId: question.source.requestId, timestamp: recovery.recoveredAt, generated: true,
      text: "Retained questions from interrupted work. Recovery did not resume this work.", questionHistory });
  }
  return [...requests, ...messages].sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
}

const json = (response, status, value) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
};
async function bytes(request, maximum) {
  const chunks = []; let count = 0;
  for await (const chunk of request) { count += chunk.length; requireCondition(count <= maximum, "Request exceeds its size bound."); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function body(request) {
  requireCondition(request.headers["content-type"]?.startsWith("application/json"), "Use application/json.");
  return JSON.parse((await bytes(request, 65536)).toString("utf8"));
}

export async function createHumanLoopProvider({ repositoryRoot, publicDirectory, getInstallation, events, permissions, start, openBrowser,
  openProjectFolder: revealProject = openProjectFolder, surface = "canvas", projectHost = null }) {
  requireCondition(["canvas", "browser"].includes(surface), "Unsupported Tandem delivery surface.");
  if (projectHost) requireCondition(/^http:\/\/127\.0\.0\.1:\d+$/.test(projectHost.origin)
    && /^[a-zA-Z0-9-]{1,100}$/.test(projectHost.channel), "Invalid project presentation binding.");
  const root = resolve(repositoryRoot), publicRoot = resolve(publicDirectory), streams = new Set();
  let url;
  const runtime = () => getInstallation()?.runtime ?? null;
  const requireRuntime = () => { const value = runtime(); requireCondition(value, "The project runtime is not initialized."); return value; };
  const attachments = new AnnotationAttachmentStore(root);
  const preferences = new HumanLoopPreferences(root);
  async function settings() {
    return { preferences: await preferences.read(), model: runtime()?.modelSettings ? await runtime().modelSettings()
      : { models: [], actual: null, canChange: false, reason: "Private model selection becomes available when the automatically started runtime is Ready." } };
  }
  async function snapshot() {
    const installation = getInstallation();
    const running = runtime();
    const installed = installation ? await installation.read() : { status: "attaching", reason: "Attaching the current main session." };
    if (!running || !["ready", "closed"].includes(installed.status)) return { schemaVersion: "human-loop-snapshot-view/v1", streamId: events.streamId,
      installation: installed,
      workflow: null, design: null, messages: [], events: events.list(), accessRequests: permissions.list(), processes: { apps: [], commands: [] } };
    const [state, readiness, originals, design, processes] = await Promise.all([
      running.state(), running.readiness(), running.conversation(), running.currentDesign(), running.commands.read(),
    ]);
    return { schemaVersion: "human-loop-snapshot-view/v1", streamId: events.streamId,
      installation: installed, workflow: projectHumanLoopView(state, readiness),
      design, cycles: state.cycles.map(projectHumanCycle), messages: projectHumanConversation(state, originals), events: events.list(),
      historyRequests: state.requests.slice(-500).map(({ id, receivedAt }) => ({ id, receivedAt })),
      recoveries: (state.recoveries ?? []).map(({ id, recoveredAt }) => ({ id, recoveredAt })),
      accessRequests: permissions.list(running.sessionId), rememberedApprovals: permissions.remembered?.(running.sessionId) ?? { all: false, tools: [] }, processes };
  }
  const server = createServer(async (request, response) => {
    let admission = null;
    try {
      requireCondition(request.headers.host === new URL(url).host, "Unexpected loopback host.");
      if (request.method !== "GET") {
        requireCondition(!request.headers.origin || request.headers.origin === new URL(url).origin, "Cross-origin mutation is not allowed.");
        requireCondition(request.headers["sec-fetch-site"] !== "cross-site", "Cross-site mutation is not allowed.");
      }
      const path = new URL(request.url, url).pathname;
      if (request.method === "GET" && path === "/api/settings") return json(response, 200, await settings());
      if (request.method === "POST" && path === "/api/settings") {
        const data = object(await body(request), ["theme", "fontSize"]);
        await preferences.update(data); events.touch();
        return json(response, 200, await settings());
      }
      if (request.method === "POST" && path === "/api/settings/model") {
        const input = await body(request);
        const data = object(input, ["action", "model", ...(Object.hasOwn(input ?? {}, "reasoningEffort") ? ["reasoningEffort"] : [])]);
        requireCondition(["select", "accept-actual"].includes(data.action), "Unknown model setting action.");
        requireCondition(data.action === "accept-actual" ? data.model === null
          : typeof data.model === "string" && data.model.trim() === data.model && data.model.length > 0 && data.model.length <= 200, "Invalid model selection.");
        requireCondition((await getInstallation().read()).status === "ready", "Private runtime must be Ready for model settings.");
        requireCondition(data.reasoningEffort === undefined || data.reasoningEffort === null
          || typeof data.reasoningEffort === "string" && data.reasoningEffort.trim() === data.reasoningEffort
            && data.reasoningEffort.length > 0 && data.reasoningEffort.length <= 40, "Invalid reasoning effort selection.");
        requireCondition(data.action !== "accept-actual" || data.reasoningEffort == null,
          "Accept actual reads native reasoning effort; it cannot override it.");
        await requireRuntime().changeModel({ model: data.model, reasoningEffort: data.reasoningEffort ?? null,
          acceptActual: data.action === "accept-actual" });
        return json(response, 200, await settings());
      }
      if (request.method === "GET" && path === "/api/host-state") {
        const query = new URL(request.url, url).searchParams;
        return json(response, 200, await getHostStateWal(root).inventory(query.get("after"), Number(query.get("limit") ?? 100)));
      }
      if (request.method === "GET" && path === "/api/snapshot") return json(response, 200, await snapshot());
      if (request.method === "GET" && path === "/api/events") {
        response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        response.write(`event: update\ndata: ${JSON.stringify({ streamId: events.streamId })}\n\n`);
        streams.add(response);
        request.on("close", () => streams.delete(response)); return;
      }
      if (request.method === "POST" && path === "/api/runtime/start") {
        const input = await body(request);
        object(input, Object.hasOwn(input, "retry") ? ["retry"] : []);
        requireCondition(input.retry === undefined || input.retry === true, "Retry must be an explicit affirmative action.");
        await start({ retry: input.retry === true });
        return json(response, 200, await snapshot());
      }
      if (request.method === "POST" && path === "/api/runtime/initial-creation/inspect") {
        object(await body(request), []);
        const installation = getInstallation();
        requireCondition(typeof installation?.requestInitialCreationRecovery === "function", "Unused-setup recovery inspection is unavailable.");
        return json(response, 200, await installation.requestInitialCreationRecovery());
      }
      if (request.method === "POST" && path === "/api/runtime/initial-creation/decision") {
        const input = object(await body(request), ["confirmationId", "approve"]);
        requireCondition(typeof input.confirmationId === "string" && typeof input.approve === "boolean",
          "A fresh explicit unused-setup recovery decision is required.");
        const installation = getInstallation();
        requireCondition(typeof installation?.decideInitialCreationRecovery === "function", "Unused-setup recovery is unavailable.");
        const result = await installation.decideInitialCreationRecovery(input);
        if (result.recovered) await start();
        return json(response, 200, result);
      }
      if (request.method === "POST" && path === "/api/navigation/open") {
        const data = object(await body(request), ["url", "focus"]);
        const address = normalizeNavigationUrl(data.url);
        requireCondition(typeof data.focus === "boolean", "Browser focus must be a boolean.");
        requireCondition(typeof openBrowser === "function", "Host browser navigation is unavailable. Copy the address and open it using the Host browser controls.");
        const opened = await openBrowser(address, { focus: data.focus });
        requireCondition(typeof opened?.instanceId === "string" && opened.instanceId, "Host browser opening was not confirmed.");
        return json(response, 200, { opened: true, instanceId: opened.instanceId });
      }
      if (request.method === "POST" && ["/api/requests", "/api/answers"].includes(path)) {
        const data = await body(request), keys = ["id", "message", "receivedAt", ...(path === "/api/answers" ? ["answers"] : []),
          ...(Object.hasOwn(data, "attachments") ? ["attachments"] : [])];
        object(data, keys);
        admission = { id: data.id, message: data.message, receivedAt: data.receivedAt,
          answers: path === "/api/answers" ? data.answers : null, attachments: data.attachments ?? [] };
        requireCondition((await getInstallation().read()).status === "ready",
          "The runtime is not ready for admission; closing or reopening does not accept new requests.");
        requireCondition(path !== "/api/answers" || !data.attachments, "Answer envelopes cannot carry unrelated composer attachments.");
        const ref = data.attachments === undefined ? [] : parseRequestAttachments(data.attachments);
        const instance = requireRuntime(), hasAnnotation = ref.some(attachment => !isImageAttachment(attachment));
        const state = hasAnnotation ? await instance.state() : null;
        const design = hasAnnotation ? await instance.currentDesign() : null;
        for (const attachment of ref) {
          if (isImageAttachment(attachment)) { await readRequestAttachment(root, attachment); continue; }
          requireCondition(state.requests.some(({ id }) => id === data.id) || attachment.source.revisionId === state.design.revisionId,
            "The diagram attachment belongs to an earlier Design revision.");
          await attachments.read(attachment);
          if (!state.requests.some(({ id }) => id === data.id)) validateArtifactAnnotationSource(attachment.source, state.design, design.content);
        }
        requireCondition(typeof data.message === "string" && (data.message.trim() || ref.length), "A request needs text or an image.");
        const input = { id: text(data.id), message: data.message, receivedAt: text(data.receivedAt),
          answers: path === "/api/answers" ? data.answers : null, ...(ref.length ? { attachments: ref } : {}) };
        await instance.send(input);
        return json(response, 202, { requestId: input.id });
      }
      const confirmation = /^\/api\/implementation-confirmations\/([^/]+)$/.exec(path);
      if (request.method === "POST" && confirmation) {
        const data = object(await body(request), ["decision"]);
        requireCondition(["approved", "design", "cancelled"].includes(data.decision), "Unknown implementation confirmation decision.");
        requireCondition((await getInstallation().read()).status === "ready", "The runtime is not ready for confirmation.");
        return json(response, 200, await requireRuntime().decideImplementation({
          confirmationId: decodeURIComponent(confirmation[1]), decision: data.decision,
        }));
      }
      if (request.method === "POST" && path === "/api/stop") {
        const input = await body(request);
        const data = object(input, input && Object.hasOwn(input, "mode") ? ["stopId", "mode"] : ["stopId"]);
        requireCondition(data.mode === undefined || ["after-step", "immediate"].includes(data.mode), "Unknown Stop mode.");
        await requireRuntime().stop(text(data.stopId), data.mode ?? "after-step");
        return json(response, 200, await snapshot());
      }
      if (request.method === "POST" && path === "/api/runtime/close") {
        await body(request); return json(response, 200, await getInstallation().close());
      }
      if (request.method === "POST" && path === "/api/project/open-folder") {
        object(await body(request), []);
        const result = await revealProject(root);
        requireCondition(result?.requested === true, "The file manager launch was not confirmed.");
        return json(response, 200, result);
      }
      if (request.method === "POST" && path === "/api/context/compaction/request") {
        object(await body(request), []);
        return json(response, 200, await requireRuntime().requestCompaction());
      }
      if (request.method === "POST" && path === "/api/context/compaction/decision") {
        const data = object(await body(request), ["requestId", "approve"]);
        requireCondition(typeof data.approve === "boolean", "An explicit compaction approval or refusal is required.");
        return json(response, 200, await requireRuntime().decideCompaction({ requestId: text(data.requestId), approve: data.approve }));
      }
      if (request.method === "POST" && path === "/api/permissions/reset") {
        object(await body(request), []);
        await requireRuntime().resetRememberedApprovals((sessionId) => permissions.resetSession(sessionId));
        events.append({ type: "permission.reset", source: "user",
          summary: "Remembered approvals reset for future requests. Already authorized commands were not cancelled." });
        return json(response, 200, await snapshot());
      }
      if (request.method === "POST" && path === "/api/permissions/off") {
        object(await body(request), []);
        permissions.revokeAll(requireRuntime().sessionId);
        events.append({ type: "permission.reset", source: "user",
          summary: "Session-wide automatic access is Off. Pending requests and already authorized commands were not cancelled." });
        return json(response, 200, await snapshot());
      }
      if (request.method === "POST" && path === "/api/permissions/once") {
        const data = object(await body(request), ["requestIds"]);
        const sessionId = requireRuntime().sessionId;
        const results = await permissions.approvePendingOnce(sessionId, data.requestIds);
        return json(response, 200, { results, accessRequests: permissions.list(sessionId) });
      }
      const permission = /^\/api\/access\/([^/]+)$/.exec(path);
      if (request.method === "POST" && permission) {
        const data = object(await body(request), ["decision"]);
        requireCondition(["once", "session", "all", "denied"].includes(data.decision), "Unknown permission decision.");
        const sessionId = requireRuntime().sessionId;
        await permissions.decide(decodeURIComponent(permission[1]), data.decision, sessionId);
        return json(response, 200, { accessRequests: permissions.list(sessionId) });
      }
      if (request.method === "POST" && path === "/api/apps/stop") {
        const data = object(await body(request), ["id"]);
        return json(response, 200, await requireRuntime().commands.stop(text(data.id)));
      }
      if (request.method === "POST" && path === "/api/image-attachments") {
        const mimeType = String(request.headers["content-type"] ?? "").split(";")[0].toLowerCase();
        requireCondition(["image/png", "image/jpeg"].includes(mimeType), "Paste a PNG or JPEG image; other image types are unsupported.");
        const capability = await requireRuntime().transport.attachmentCapabilities(mimeType);
        requireCondition(capability.supported, capability.reason ?? "Selected model cannot receive this image.");
        const attachment = await new ImageAttachmentStore(root).put(await bytes(request, capability.limits.maxBytes), mimeType);
        return json(response, 200, { attachment });
      }
      if (request.method === "POST" && path === "/api/annotation-attachments") {
        let maximumBytes = 4 * 1024 * 1024;
        if (requireRuntime().transport?.attachmentCapabilities) {
          const capability = await requireRuntime().transport.attachmentCapabilities();
          requireCondition(capability.supported, capability.reason ?? "The selected private model cannot receive images.");
          maximumBytes = Math.min(maximumBytes, capability.limits.maxBytes);
        }
        const state = await requireRuntime().state();
        const source = JSON.parse(decodeURIComponent(String(request.headers["x-annotation-source"] ?? "")));
        requireCondition(source.revisionId === state.design.revisionId && source.revisionId, "A current Design diagram is required.");
        const design = await requireRuntime().currentDesign();
        requireCondition(policyHash(design.binding) === policyHash(state.design), "The current Design changed during annotation upload.");
        validateArtifactAnnotationSource(source, state.design, design.content);
        const attachment = await attachments.put(await bytes(request, maximumBytes), source);
        return json(response, 201, { attachment });
      }
      const image = /^\/api\/(?:annotation|image)-attachments\/([^/]+)$/.exec(path);
      if (request.method === "GET" && image) {
        const state = await requireRuntime().state();
        const ref = state.requests.flatMap((request) => request.attachments ?? []).find(({ id }) => id === decodeURIComponent(image[1]));
        requireCondition(ref, "Unknown retained attachment.");
        const content = await readRequestAttachment(root, ref);
        response.writeHead(200, { "content-type": ref.mimeType, "x-content-type-options": "nosniff", "cache-control": "private, max-age=31536000, immutable" });
        response.end(content); return;
      }
      if (path.startsWith("/api/")) return json(response, 409, { error: "Unsupported or stale action. Human-loop/v1 has no technical-plan approval, per-item Review or Apply workflow." });
      requireCondition(request.method === "GET", "Unsupported method.");
      const relativePath = path === "/" || path === "/index.html" ? "human-loop.html" : decodeURIComponent(path.slice(1));
      const file = resolve(publicRoot, relativePath), tail = relative(publicRoot, file);
      requireCondition(tail && !isAbsolute(tail) && tail !== ".." && !tail.startsWith(`..${sep}`), "Static path escapes the renderer.");
      const info = await lstat(file);
      const actual = resolve(await realpath(file));
      requireCondition(info.isFile() && !info.isSymbolicLink()
        && (process.platform === "win32" ? actual.toLowerCase() === file.toLowerCase() : actual === file), "Static file is aliased or unavailable.");
      const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".json": "application/json" };
      let content = await readFile(file);
      if (file === resolve(publicRoot, "human-loop.html") && surface === "browser") {
        const html = content.toString("utf8");
        requireCondition(html.includes('data-tandem-surface="canvas"'), "Renderer lacks an explicit Tandem surface binding.");
        content = Buffer.from(html.replace('data-tandem-surface="canvas"', 'data-tandem-surface="browser"'));
      }
      if (file === resolve(publicRoot, "human-loop.html") && projectHost) {
        const panel = new URL(request.url, url).searchParams.get("panel") ?? "workspace";
        requireCondition(panel === "workspace", "Unknown project presentation panel.");
        content = Buffer.from(content.toString("utf8").replace('class="human-app"',
          `class="human-app" data-project-panel="${panel}" data-project-origin="${projectHost.origin}" data-project-channel="${projectHost.channel}"`));
      }
      response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-store",
        "x-content-type-options": "nosniff" });
      response.end(content);
    } catch (error) {
      const outcome = {};
      if (admission) {
        try {
          const state = await runtime()?.state();
          const saved = state?.requests.find(({ id }) => id === admission.id);
          if (saved) {
            const original = { id: saved.id, message: saved.message, receivedAt: saved.receivedAt,
              answers: saved.answers, attachments: saved.attachments ?? [] };
            if (policyHash(original) === policyHash(admission)) outcome.accepted = true;
            else outcome.notAccepted = true;
          } else if (state) outcome.notAccepted = true;
        } catch { /* No read proof means the client must retain its retry identity. */ }
      }
      json(response, error.code === "ENOENT" ? 404 : 409, { error: error.message, ...outcome });
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  url = `http://127.0.0.1:${server.address().port}/`;
  const unsubscribe = events.subscribe((event) => {
    const data = `event: update\ndata: ${JSON.stringify({ sequence: event.sequence, type: event.type })}\n\n`;
    for (const response of streams) response.write(data);
  });
  const heartbeat = setInterval(() => { for (const response of streams) response.write(": heartbeat\n\n"); }, 15000);
  heartbeat.unref?.();
  return { id: randomUUID(), url, snapshot, async close() {
    clearInterval(heartbeat); unsubscribe(); for (const response of streams) response.end();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  } };
}
