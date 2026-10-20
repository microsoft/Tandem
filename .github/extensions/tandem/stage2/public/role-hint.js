// This syntax is opt-in at submission, never inferred from retained requests.
export function parseRoleMention(message) {
  const leading = /^@(designer|agent)(?=\s|$)/.exec(message);
  if (!leading) return { roleHint: null, error: null };
  const body = message.slice(leading[0].length).trim();
  if (/^@(designer|agent)(?=\s|$)/.test(body)) {
    return { roleHint: null, error: 'Use only one leading role hint: @designer or @agent. Router decides who responds.' };
  }
  if (!body) return { roleHint: null, error: 'Add a message after the role hint, or remove it. Your draft is kept.' };
  return { roleHint: { schemaVersion: 'human-role-hint/v1', role: leading[1] }, error: null };
}
