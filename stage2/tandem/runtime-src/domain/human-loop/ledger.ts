import { choice, list, object, requireCondition } from '../workflow/validation.ts';
import { createHumanLoop, parseHumanLoopOwner, transitionHumanLoop, type HumanLoopOwner, type HumanLoopState } from './model.ts';
import { parseDesignBinding, type Authority, type DesignBinding } from './contracts.ts';

export interface HumanLoopLedger {
  schemaVersion: 'human-loop-ledger/v2';
  owner: HumanLoopOwner; initialDesign: DesignBinding;
  events: Array<{ authority: Authority; command: unknown }>;
}
export function createHumanLoopLedger(owner: unknown, initialDesign: DesignBinding): HumanLoopLedger {
  return { schemaVersion: 'human-loop-ledger/v2', owner: parseHumanLoopOwner(owner),
    initialDesign: parseDesignBinding(initialDesign), events: [] };
}
export function replayHumanLoopLedger(value: unknown): { ledger: HumanLoopLedger; state: HumanLoopState } {
  const data = object(value, ['schemaVersion', 'owner', 'initialDesign', 'events']);
  requireCondition(data.schemaVersion === 'human-loop-ledger/v2', 'Incompatible workflow ledger; use a fresh workspace. Existing workspaces are not migrated.');
  const owner = parseHumanLoopOwner(data.owner), initialDesign = parseDesignBinding(data.initialDesign);
  const events = list(data.events, (value) => {
    const event = object(value, ['authority', 'command']);
    return { authority: choice(event.authority, ['user', 'host', 'agent', 'runtime'] as const),
      command: structuredClone(event.command) };
  });
  let state = createHumanLoop(owner, initialDesign);
  for (const event of events) state = transitionHumanLoop(state, event.authority, event.command, true);
  return { ledger: { schemaVersion: 'human-loop-ledger/v2', owner, initialDesign, events }, state };
}
