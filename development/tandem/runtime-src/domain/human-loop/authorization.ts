import { parseRoleResult, parseTaskBinding } from './contracts.ts';
import { isStaleAnswer, hasMixedImplementationAnswers, requireImplementationConfirmation, type HumanLoopState } from './model.ts';
import { requireCondition } from '../workflow/validation.ts';

/** Live admission policy only: historical ledger replay must retain its original facts. */
export function validateHumanImplementationAuthorization(state: HumanLoopState, type: string, data: unknown): void {
  if (['start-cycle', 'resume-cycle', 'prepare-replan', 'accept-plan'].includes(type)
    || type === 'start-role' && ['planner', 'implementer', 'reviewer'].includes(parseTaskBinding(data).role)) {
    requireImplementationConfirmation(state);
  }
  const request = state.requests.find(({ id }) => id === state.activeRequestId);
  if (!request?.answers) return;
  const resultCommand = ['stage-result', 'submit-result', 'complete-role-result'].includes(type);
  if (resultCommand && state.activeTask?.binding.role !== 'router') return;
  const route = resultCommand ? parseRoleResult('router', data).outcome : request.route?.outcome;
  if (resultCommand && route?.kind === 'route' && hasMixedImplementationAnswers(request)) requireCondition(route.intent === 'design',
    'Mixed Design and implementation answers must go to Designer first. Implementation needs confirmation after the Design handoff.');
  const implementationRoute = route?.kind === 'route' && route.intent === 'implement';
  const newAdmission = resultCommand || type === 'start-cycle'
    || (type === 'start-role' && ['planner', 'implementer'].includes(parseTaskBinding(data).role));
  if (!implementationRoute || !newAdmission) return;
  requireCondition(!isStaleAnswer(state, request),
    'Implementation interpretation requires this user request\'s canonical saved answers. Source role is context, not authority.');
}
