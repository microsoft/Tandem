import { bindQuestionOptions } from "../runtime-src/domain/human-loop/contracts.ts";

export function bindSelectedOptions(request, state) {
  return bindQuestionOptions(request, state.questions);
}
