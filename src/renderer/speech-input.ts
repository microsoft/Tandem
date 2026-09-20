export function composeSpeechDraft(baseline: string, start: number, end: number, transcript: string): string {
  if (!transcript) return baseline;
  const before = baseline.slice(0, start);
  const after = baseline.slice(end);
  return before + (before && !/\s$/.test(before) ? " " : "") + transcript
    + (after && !/^[\s.,!?;:]/.test(after) ? " " : "") + after;
}
