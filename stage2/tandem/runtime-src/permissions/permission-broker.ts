import { randomUUID } from 'node:crypto';
import {
  approveAll,
  type PermissionHandler,
  type PermissionRequest,
  type PermissionRequestResult,
  type UserToolSessionApproval,
} from '@github/copilot-sdk';
import type { InMemoryEventStore } from '../event-store.js';

export type AccessDecision = 'once' | 'session' | 'all' | 'denied';
export type PermissionInvocation = Parameters<PermissionHandler>[1];

export interface AccessRequestView {
  id: string;
  kind: PermissionRequest['kind'];
  title: string;
  description: string;
  scopes: string[];
  canApproveForSession: boolean;
  canApproveAll: boolean;
  elevated: boolean;
  createdAt: string;
  nativeInvocation?: { sessionId: string; toolCallId: string; toolName: string; taskId: string; requestId: string };
}

interface PendingAccessRequest {
  request: PermissionRequest;
  invocation: PermissionInvocation;
  view: AccessRequestView;
  resolve: (result: PermissionRequestResult) => void;
  cleanup: () => void;
}

const withdrawnResult = (): PermissionRequestResult => ({
  kind: 'reject',
  feedback: 'This permission request was withdrawn because its owning task no longer permits this action.',
});

function permissionResult(approved: PermissionRequestResult | { kind: 'attributed'; result: PermissionRequestResult }): PermissionRequestResult {
  return approved.kind === 'attributed' ? approved.result : approved;
}

function canApproveAll(
  request: PermissionRequest,
  invocation: PermissionInvocation,
): boolean {
  if (invocation.managedSettingsEnabled) {
    return false;
  }
  return !(
    'managedApprovalRequired' in request
    && request.managedApprovalRequired !== undefined
    && request.managedApprovalRequired !== false
  );
}

function sessionApproval(request: PermissionRequest): UserToolSessionApproval | undefined {
  switch (request.kind) {
    case 'shell':
      return request.canOfferSessionApproval
        ? {
            kind: 'commands',
            commandIdentifiers: [...new Set(request.commands.map((command) => command.identifier))],
          }
        : undefined;
    case 'write':
      return request.canOfferSessionApproval ? { kind: 'write' } : undefined;
    case 'read':
      return { kind: 'read' };
    case 'mcp':
      return { kind: 'mcp', serverName: request.serverName, toolName: request.toolName };
    case 'memory':
      return { kind: 'memory' };
    case 'custom-tool':
      return { kind: 'custom-tool', toolName: request.toolName };
    case 'extension-management':
      return { kind: 'extension-management', operation: request.operation };
    case 'factory':
      return { kind: 'factory', approvalKey: request.approvalKey };
    case 'extension-permission-access':
      return { kind: 'extension-permission-access', extensionName: request.extensionName };
    case 'url':
    case 'hook':
      return undefined;
  }
}

function requestCopy(request: PermissionRequest): {
  title: string;
  description: string;
  scopes: string[];
  elevated: boolean;
} {
  switch (request.kind) {
    case 'shell':
      return {
        title: 'Allow the agent to run this shell command?',
        description: request.intention,
        scopes: [
          request.fullCommandText,
          ...request.possiblePaths,
          ...request.possibleUrls.map(({ url }) => url),
        ],
        elevated: request.requestSandboxBypass === true,
      };
    case 'write':
      return {
        title: 'Allow the agent to write this file?',
        description: request.intention,
        scopes: ['filesystem write', request.fileName,
          ...(typeof request.diff === 'string' ? [`Diff:\n${request.diff}`]
            : typeof request.newFileContents === 'string' ? [`New contents:\n${request.newFileContents}`] : [])],
        elevated: request.requestSandboxBypass === true,
      };
    case 'read':
      return {
        title: 'Allow the agent to read this path?',
        description: request.intention,
        scopes: ['read-only', request.path],
        elevated: request.requestSandboxBypass === true,
      };
    case 'mcp':
      return {
        title: `Allow the agent to use ${request.toolTitle}?`,
        description: `Invoke ${request.toolName} on the ${request.serverName} MCP server.`,
        scopes: [request.readOnly ? 'read-only' : 'may modify data', request.serverName, request.toolName],
        elevated: false,
      };
    case 'url':
      return {
        title: 'Allow the agent to access this URL?',
        description: request.intention,
        scopes: ['network', request.url],
        elevated: request.requestSandboxBypass === true,
      };
    case 'memory':
      return {
        title: 'Allow the agent to update Copilot memory?',
        description: request.reason ?? 'Store or vote on a long-term memory.',
        scopes: [request.action ?? 'memory', request.subject ?? request.fact],
        elevated: false,
      };
    case 'custom-tool': {
      const args = request.args && typeof request.args === 'object' && !Array.isArray(request.args)
        ? request.args as Record<string, unknown> : null;
      const command = typeof args?.command === 'string' ? args.command : null;
      return {
        title: command ? `${request.toolName === 'start_workflow_app' ? 'Start app with' : 'Run'} ${command}?` : `Allow the agent to use ${request.toolName}?`,
        description: request.toolDescription,
        scopes: command ? [`Purpose: ${typeof args?.purpose === 'string' ? args.purpose : 'Not separately supplied.'}`,
          `Command: ${command}`, `Arguments: ${JSON.stringify(args?.args)}`, `Working directory: ${args?.cwd ?? '.'}`,
          `Tool: ${request.toolName}`] : ['custom tool', request.toolName],
        elevated: false,
      };
    }
    case 'hook':
      return {
        title: `Allow ${request.toolName} to continue?`,
        description: request.hookMessage ?? 'A runtime hook requires confirmation.',
        scopes: ['hook confirmation', request.toolName],
        elevated: false,
      };
    case 'extension-management':
      return {
        title: `Allow extension ${request.operation}?`,
        description: request.extensionName
          ? `Apply ${request.operation} to ${request.extensionName}.`
          : `Run extension operation ${request.operation}.`,
        scopes: ['extension management', request.extensionName ?? request.operation],
        elevated: false,
      };
    case 'factory':
      return {
        title: `Allow factory ${request.name} to run?`,
        description: request.description,
        scopes: ['factory', request.operation, request.approvalKey],
        elevated: false,
      };
    case 'extension-permission-access':
      return {
        title: `Allow ${request.extensionName} to access these capabilities?`,
        description: 'An extension is requesting permission-gated capabilities.',
        scopes: ['extension access', request.extensionName, ...request.capabilities],
        elevated: false,
      };
  }
}

export class PermissionBroker {
  readonly #events: InMemoryEventStore;
  readonly #pending = new Map<string, PendingAccessRequest>();
  readonly #approveAllForSessions = new Map<string, string>();
  readonly #rememberedTools = new Map<string, Set<string>>();
  readonly #sessionGenerations = new Map<string, number>();

  constructor(events: InMemoryEventStore) {
    this.#events = events;
  }

  async request(
    request: PermissionRequest,
    invocation: PermissionInvocation = { sessionId: 'living-canvas' },
    signal?: AbortSignal,
    options: { onceOnly?: boolean; nativeSessionGrantEligible?: boolean; provenance?: { toolName: string; taskId: string; requestId: string; role?: string };
      nativeCompletion?: AbortSignal } = {},
  ): Promise<PermissionRequestResult> {
    const generation = this.#sessionGenerations.get(invocation.sessionId) ?? 0;
    const allEligible = !options.onceOnly || (options.nativeSessionGrantEligible === true && Boolean(request.toolCallId));
    const grantRequestId = this.#approveAllForSessions.get(invocation.sessionId);
    if (options.nativeCompletion?.aborted) return { kind: 'no-result' };
    if (signal?.aborted) return withdrawnResult();
    if (allEligible && grantRequestId && canApproveAll(request, invocation)) {
      const result = permissionResult(await approveAll(request, invocation));
      if (options.nativeCompletion?.aborted) return { kind: 'no-result' };
      if (signal?.aborted || generation !== (this.#sessionGenerations.get(invocation.sessionId) ?? 0)) return withdrawnResult();
      if (result.kind !== 'no-result' && this.#approveAllForSessions.get(invocation.sessionId) === grantRequestId) {
        this.#events.append({
          type: 'permission.granted',
          source: 'system',
          summary: `Allowed automatically: ${requestCopy(request).title}`,
          data: { decision: 'all', grantRequestId, permissionKind: request.kind,
            ...(options.provenance && request.toolCallId ? { activity: {
              sessionId: invocation.sessionId, toolCallId: request.toolCallId, ...options.provenance,
            } } : {}),
            action: requestCopy(request) },
        });
        return result;
      }
    }

    const id = randomUUID();
    const copy = requestCopy(request);
    const view: AccessRequestView = {
      id,
      kind: request.kind,
      ...copy,
      canApproveForSession: !options.onceOnly && sessionApproval(request) !== undefined,
      canApproveAll: allEligible && canApproveAll(request, invocation),
      createdAt: new Date().toISOString(),
      ...(options.onceOnly && options.provenance && request.toolCallId
        ? { nativeInvocation: { sessionId: invocation.sessionId, toolCallId: request.toolCallId, ...options.provenance } } : {}),
    };

    return new Promise((resolve) => {
      const onAbort = () => this.#withdraw(id);
      const onNativeCompletion = () => this.#withdraw(id, true);
      this.#pending.set(id, { request, invocation, view, resolve,
        cleanup: () => {
          signal?.removeEventListener('abort', onAbort);
          options.nativeCompletion?.removeEventListener('abort', onNativeCompletion);
        } });
      signal?.addEventListener('abort', onAbort, { once: true });
      options.nativeCompletion?.addEventListener('abort', onNativeCompletion, { once: true });
      if (options.nativeCompletion?.aborted) { this.#withdraw(id, true); return; }
      if (signal?.aborted) { this.#withdraw(id); return; }
      this.#events.append({
        type: 'permission.requested',
        source: 'copilot',
        summary: view.title,
        data: view,
      });
    });
  }

  list(sessionId?: string): AccessRequestView[] {
    return [...this.#pending.values()].filter(pending => sessionId === undefined || pending.invocation.sessionId === sessionId)
      .map(({ view }) => view);
  }

  remembered(sessionId: string): { all: boolean; tools: string[] } {
    return { all: this.#approveAllForSessions.has(sessionId), tools: [...(this.#rememberedTools.get(sessionId) ?? [])] };
  }

  #take(id: string, pending: PendingAccessRequest): boolean {
    if (this.#pending.get(id) !== pending) return false;
    this.#pending.delete(id);
    pending.cleanup();
    return true;
  }

  #withdraw(id: string, nativeCompleted = false): void {
    const pending = this.#pending.get(id);
    if (!pending || !this.#take(id, pending)) return;
    pending.resolve(nativeCompleted ? { kind: 'no-result' } : withdrawnResult());
    this.#events.append({
      type: 'permission.cancelled',
      source: 'system',
      summary: `${nativeCompleted ? 'Resolved in host' : 'Withdrawn'}: ${pending.view.title}`,
      data: { requestId: id, ...(nativeCompleted ? { reason: 'native-completion' } : {}) },
    });
  }

  async approvePendingOnce(sessionId: string, ids: string[]): Promise<{ requestId: string; status: 'approved' | 'not-pending' }[]> {
    if (!sessionId || !Array.isArray(ids) || ids.length === 0 || ids.length > 128
      || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !id.trim())) {
      throw new Error('Supply an exact, nonempty set of up to 128 distinct pending permission IDs.');
    }
    for (const id of ids) {
      const pending = this.#pending.get(id);
      if (pending && pending.invocation.sessionId !== sessionId) throw new Error('Permission belongs to a different session.');
    }
    const results: { requestId: string; status: 'approved' | 'not-pending' }[] = [];
    for (const id of ids) {
      if (!this.#pending.has(id)) { results.push({ requestId: id, status: 'not-pending' }); continue; }
      await this.decide(id, 'once', sessionId);
      results.push({ requestId: id, status: 'approved' });
    }
    return results;
  }

  async decide(id: string, decision: AccessDecision, sessionId?: string): Promise<void> {
    const pending = this.#pending.get(id);
    if (!pending) {
      throw new Error(`Access request ${id} is not pending.`);
    }
    if (sessionId !== undefined && pending.invocation.sessionId !== sessionId) throw new Error('Permission belongs to a different session.');

    if (decision === 'all') {
      if (!pending.view.canApproveAll) {
        throw new Error('Managed policy prevents approving all access for this session.');
      }
      const sessionId = pending.invocation.sessionId;
      const generation = this.#sessionGenerations.get(sessionId) ?? 0;
      this.#approveAllForSessions.set(sessionId, id);
      for (const [pendingId, queued] of this.#pending) {
        if (!queued.view.canApproveAll || queued.invocation.sessionId !== pending.invocation.sessionId) {
          continue;
        }
        const result = permissionResult(await approveAll(queued.request, queued.invocation));
        if (generation !== (this.#sessionGenerations.get(sessionId) ?? 0)
          || this.#approveAllForSessions.get(sessionId) !== id) return;
        if (result.kind === 'no-result') {
          continue;
        }
        if (!this.#take(pendingId, queued)) continue;
        this.#events.append({
          type: 'permission.granted',
          source: 'user',
          summary: `Allowed for this session: ${queued.view.title}`,
          data: { requestId: pendingId, decision, grantRequestId: id, action: requestCopy(queued.request) },
        });
        queued.resolve(result);
      }
      return;
    }

    let result: PermissionRequestResult;
    if (decision === 'denied') {
      result = {
        kind: 'reject',
        feedback: 'The user denied this operation in the Living Canvas.',
      };
    } else if (decision === 'once') {
      result = { kind: 'approve-once', approvedInteractively: true };
    } else {
      if (!pending.view.canApproveForSession) throw new Error('This access request cannot be approved for the session.');
      const approval = sessionApproval(pending.request);
      if (!approval) {
        throw new Error('This access request cannot be approved for the session.');
      }
      result = { kind: 'approve-for-session', approval };
    }

    if (!this.#take(id, pending)) throw new Error(`Access request ${id} is not pending.`);
    if (decision === 'session') {
      const tools = this.#rememberedTools.get(pending.invocation.sessionId) ?? new Set<string>();
      tools.add(pending.request.kind === 'custom-tool' ? pending.request.toolName : pending.request.kind);
      this.#rememberedTools.set(pending.invocation.sessionId, tools);
    }
    this.#events.append({
      type: decision === 'denied' ? 'permission.denied' : 'permission.granted',
      source: 'user',
      summary: decision === 'denied'
        ? `Denied: ${pending.view.title}`
        : `${decision === 'session' ? 'Allowed for session' : 'Allowed once'}: ${pending.view.title}`,
      data: { requestId: id, decision, action: requestCopy(pending.request) },
    });
    pending.resolve(result);
  }

  denyAll(feedback: string): void {
    for (const [id, pending] of this.#pending) {
      if (!this.#take(id, pending)) continue;
      pending.resolve({ kind: 'reject', feedback });
      this.#events.append({
        type: 'permission.denied',
        source: 'system',
        summary: `Cancelled: ${pending.view.title}`,
        data: { requestId: id, decision: 'denied' },
      });
    }

  }

  resetSession(sessionId: string): void {
    this.#sessionGenerations.set(sessionId, (this.#sessionGenerations.get(sessionId) ?? 0) + 1);
    this.revokeAll(sessionId);
    this.#rememberedTools.delete(sessionId);
    for (const [id, pending] of this.#pending) if (pending.invocation.sessionId === sessionId) this.#withdraw(id);
  }

  revokeAll(sessionId: string): void {
    this.#approveAllForSessions.delete(sessionId);
  }
}
