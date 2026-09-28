export const decisionCategories = Object.freeze([
  { kind: 'misaligned-decision', title: 'Decisions misaligned with agreed Design' },
  { kind: 'uncovered-decision', title: 'Consequential implementation decisions not covered by agreed Design' },
]);
const currentCategories = Object.freeze([
  { kind: 'design-conformance', title: 'Conformance to agreed Design' },
  { kind: 'over-engineering', title: 'Over-engineering' },
]);
export const reviewCoverageText = (review) => review.coverageStatus === 'unavailable'
  ? 'Substantive review unavailable. Implementation and recorded findings are retained; this is not approval.'
  : review.coverageStatus === 'partial'
    ? 'Review coverage is partial. Unreviewed scopes and reasons are listed below; this is not approval.'
    : 'No substantiated finding in a category is not complete verification or approval.';
export const emptyReviewSection = (review) => review.coverageStatus === 'unavailable' ? 'Not reviewed' : 'None';

export function decisionSections(review) {
  return (review.reviewFormat === 'decision-review/v2' ? currentCategories : decisionCategories).map(({ kind, title }) => ({
    kind, title, findings: review.findings.filter((finding) => finding.kind === kind),
  }));
}

export function technicalFindings(review) {
  return review.findings.filter(({ kind }) => ![...decisionCategories, ...currentCategories].some((category) => category.kind === kind));
}

export function decisionReportText(review) {
  const sections = decisionSections(review).map(({ title, findings }) => `${title}\n${findings.length
    ? findings.map((finding) => `${finding.summary}\nDesign basis: ${finding.designBasis}\nMaterial impact: ${finding.consequence}`
      + `\nImplementation evidence: ${finding.evidenceRefs.join('; ')}\nQuestion: ${finding.questionId}`).join('\n\n')
    : emptyReviewSection(review)}`);
  const diagnostics = technicalFindings(review);
  const evidence = [
    ...diagnostics.map((finding) => `${finding.summary} ${finding.consequence} Evidence: ${finding.evidenceRefs.join('; ')}`),
    ...review.verificationLimits.map((limit) => `${review.reviewFormat === 'decision-review/v2' ? 'Coverage / limitation' : 'Verification limit'}: ${limit}`),
  ];
  return `${review.reviewFormat === 'decision-review/v2' ? `${reviewCoverageText(review)}\n\n` : ''}${sections.join('\n\n')}\n\nCode is already in your project workspace.`
    + '\nNo automatic repair or successful review retry is required before another normally authorized request.'
    + (review.reviewFormat === 'decision-review/v2' ? '' : '\nNone means no substantiated decision in that category, not complete verification.')
    + (evidence.length ? `\n\n${review.reviewFormat === 'decision-review/v2' ? 'Coverage and limitations' : 'Technical/verification evidence'}: ${evidence.join('\n')}` : '');
}
