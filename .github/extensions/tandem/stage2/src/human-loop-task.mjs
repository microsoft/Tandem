import { parseTaskBinding } from "../runtime-src/domain/human-loop/contracts.ts";
import { policyHash } from "../runtime-src/domain/workflow/policy.ts";
import { object, requireCondition } from "../runtime-src/domain/workflow/validation.ts";

export function createHumanTask(identity, context) {
  const exactContext = JSON.parse(JSON.stringify(context));
  const binding = parseTaskBinding({ ...identity, inputDigest: policyHash({ binding: identity, context: exactContext }) });
  return { schemaVersion: "human-loop-task/v1", binding, context: exactContext };
}

export function parseHumanTask(value) {
  const data = object(value, ["schemaVersion", "binding", "context"]);
  requireCondition(data.schemaVersion === "human-loop-task/v1", "Incompatible private task; legacy approvals are not accepted.");
  const binding = parseTaskBinding(data.binding);
  const { inputDigest, ...identity } = binding;
  const context = JSON.parse(JSON.stringify(data.context));
  requireCondition(inputDigest === policyHash({ binding: identity, context }), "Private task context digest changed.");
  return { schemaVersion: "human-loop-task/v1", binding, context };
}
