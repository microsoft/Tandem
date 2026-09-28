import { isAbsolute } from 'node:path';
import { parseWorkspaceBoundary, sameBoundary, type WorkspaceBoundary } from './private-execution-contract.ts';
import { object, requireCondition, strings, text, unique } from './validation.ts';
import type { ChangePlanProposal } from './change-plan.ts';

/** Historical evidence carried into a fresh approved task, never an old approval. */
export interface RetainedWork {
  schemaVersion: 'retained-work/v1';
  stopId: string;
  operationId: string;
  sourceTaskIds: string[];
  baseline: WorkspaceBoundary;
  source: WorkspaceBoundary;
  target: WorkspaceBoundary;
  paths: string[];
}

export function parseRetainedWork(value: unknown): RetainedWork {
  const data = object(value, ['schemaVersion', 'stopId', 'operationId', 'sourceTaskIds', 'baseline', 'source', 'target', 'paths']);
  requireCondition(data.schemaVersion === 'retained-work/v1', 'unsupported retained-work evidence.');
  const sourceTaskIds = strings(data.sourceTaskIds), paths = strings(data.paths);
  unique(sourceTaskIds); unique(paths.map((path) => path.replaceAll('\\', '/').toLowerCase()));
  requireCondition(sourceTaskIds.length > 0, 'retained work requires owned task provenance.');
  for (const path of paths) requireCondition(!isAbsolute(path) && !/^[a-z]:/i.test(path)
    && !path.replaceAll('\\', '/').split('/').some((part) => !part || part === '.' || part === '..')
    && !['tandem.md', 'teleos.md'].includes(path.toLowerCase()), 'retained work has an invalid product path.');
  const baseline = parseWorkspaceBoundary(data.baseline), source = parseWorkspaceBoundary(data.source);
  const target = parseWorkspaceBoundary(data.target);
  requireCondition(baseline.commit === source.commit && source.commit === target.commit,
    'retained work crosses an unverified source/target commit boundary.');
  return { schemaVersion: 'retained-work/v1', stopId: text(data.stopId), operationId: text(data.operationId),
    sourceTaskIds, baseline, source, target, paths };
}

export function requireRetainedExecution(value: RetainedWork, before: WorkspaceBoundary): void {
  requireCondition(sameBoundary(value.source, before), 'retained work no longer matches the fresh execution baseline.');
}

export function requireRetainedPlanCoverage(plan: ChangePlanProposal, retained: RetainedWork): void {
  const first = plan.items[0];
  requireCondition(first && first.dependsOn.length === 0 && retained.paths.every((path) =>
    first.scope.some((allowed) => allowed.replaceAll('\\', '/').toLowerCase() === path.replaceAll('\\', '/').toLowerCase())),
  'the first fresh work item must cover all retained changed paths so they receive the new Review and approval.');
}
