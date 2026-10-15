/** @typedef {{ revisionId: string, digest: string }} HandoffDesign */
/** @typedef {{ requestId: string, label: string, active?: boolean, quietDesign?: HandoffDesign | null }} HandoffActivity */

export function validHandoffDesign(value) {
  return value && typeof value.revisionId === "string" && value.revisionId.length > 0 && value.revisionId.length <= 200
    && typeof value.digest === "string" && /^[a-f0-9]{64}$/.test(value.digest);
}

export function validHandoffActivity(value) {
  return value && typeof value.requestId === "string" && /^handoff-[a-f0-9]{64}$/.test(value.requestId)
    && typeof value.label === "string" && value.label.length <= 2000
    && (value.active === undefined || typeof value.active === "boolean")
    && (value.quietDesign == null || validHandoffDesign(value.quietDesign));
}

/** Only a verified, relevant published Design replaces a successful handoff notice. */
export function quietHandoff(activity, displayedDesign, permissions = 0) {
  return Boolean(permissions === 0 && activity?.active !== true && validHandoffDesign(activity?.quietDesign)
    && validHandoffDesign(displayedDesign) && activity.quietDesign.revisionId === displayedDesign.revisionId
    && activity.quietDesign.digest === displayedDesign.digest);
}

export function currentHandoffActivity(activities, requestId = null) {
  return activities?.findLast(item => item.active === true)
    ?? activities?.find(item => item.requestId === requestId) ?? activities?.at(-1) ?? null;
}
