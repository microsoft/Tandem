import { requireCondition } from './validation.ts';

/** Shared by both execution models: durable intent precedes RPC, acknowledgement precedes idle application. */
export async function abortAfterDurableIntent(options: {
  request: () => Promise<void>; acknowledge: () => Promise<void>; abort: () => Promise<unknown>;
  check: () => void; markRequested: () => void; maximumMs: number; canAbort?: () => boolean | Promise<boolean>;
}): Promise<void> {
  await options.request();
  options.check();
  if (options.canAbort && !await options.canAbort()) return;
  options.markRequested();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      options.abort(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Abort acknowledgement timed out.')), options.maximumMs);
      }),
    ]);
    options.check();
    await options.acknowledge();
  } finally { if (timer) clearTimeout(timer); }
}

export function parseOwnedQueue(value: unknown) {
  requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), 'Queue observation must be an object.');
  const data = value as Record<string, unknown>;
  requireCondition(Array.isArray(data.items) && Array.isArray(data.steeringMessages), 'Runtime queue lacks items/steeringMessages.');
  requireCondition(data.steeringMessages.length === 0, 'Private steering input is not permitted.');
  const items = data.items.map((value) => {
    requireCondition(value !== null && typeof value === 'object' && !Array.isArray(value), 'Queue row must be an object.');
    const row = value as Record<string, unknown>;
    requireCondition(row.kind === 'message' && typeof row.id === 'string' && row.id.length > 0
      && typeof row.messageId === 'string' && row.messageId.length > 0, 'Queue row lacks exact message identity or has unowned command work.');
    return { id: row.id, messageId: row.messageId };
  });
  requireCondition(new Set(items.map(({ id }) => id)).size === items.length
    && new Set(items.map(({ messageId }) => messageId)).size === items.length, 'Queue contains duplicate identity evidence.');
  return items;
}
