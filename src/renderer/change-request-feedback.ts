import type { ChangeRequest } from "../change-requests.js";
import type { LifecycleStageId } from "../types.js";
import { isDiscoveryChangeRequest } from "../change-request-policy.js";

export function changeRequestReviewStage(request: ChangeRequest | undefined): LifecycleStageId | undefined {
    if (!request || !isDiscoveryChangeRequest(request) || ["completed", "cancelled", "deferred"].includes(request.status)) return undefined;
    const stage = ["active", "reviewing"].includes(request.status) ? request.remainingStages[0] : request.assessment?.startStage;
    return stage === "none" ? undefined : stage;
}

const statuses: Record<ChangeRequest["status"], string> = {
    queued: "Request queued", analyzing: "Checking your request", proposed: "Review change impact",
    reviewing: "Reviewing draft changes", active: "Updating affected work", deferred: "Kept for later",
    completed: "Change handled", cancelled: "Cancelled", failed: "Change needs attention",
};

export function changeRequestStatus(request: ChangeRequest): string {
    if (!isDiscoveryChangeRequest(request)) return "Historical Development request";
    if (request.error && !["completed", "cancelled", "deferred"].includes(request.status)) return "Change needs attention";
    if (request.status === "proposed" && request.assessment?.question) return "A detail is needed";
    if (request.status === "completed") {
        if (request.developmentAdmission === "admitted") return "Sent to Development";
        if (request.assessment?.startStage === "none") return "No update needed";
        if (request.assessment?.stages.length === 1) {
            if (request.assessment.startStage === "sketch") return "Design draft updated";
            if (request.assessment.startStage === "requirements") return "Requirements updated";
            if (request.assessment.startStage === "prototype") return "Prototype change saved";
        }
        return "Requested changes saved";
    }
    return statuses[request.status];
}

export function changeRequestResponse(request: ChangeRequest): string {
    if (!isDiscoveryChangeRequest(request)) {
        return "Retained as history. Upstream impact review ends at Prototype; continue this request in Development."
            + (request.error ? ` Recorded error: ${request.error}` : "");
    }
    if (request.error) return request.error;
    switch (request.status) {
        case "queued": return "Your request is saved and waiting for current work. No changes have been applied yet.";
        case "analyzing": return "Checking the requested change against your saved decisions and designs.";
        case "proposed": return request.assessment?.question
            ? `No changes applied yet. ${request.assessment.question}`
            : "Not applied yet. Review the proposed changes to continue.";
        case "reviewing": return "Review the separate draft, then choose Apply changes. Accepted work is unchanged until you apply it.";
        case "active": return "The request is in progress. Review the affected work before its next approval.";
        case "deferred": return "Saved for later. It is not blocking current work; resume it when you are ready.";
        case "failed": return "The request could not finish. Review its details before retrying.";
        case "cancelled": return "The remaining request was cancelled. Previously saved work is retained.";
        case "completed":
            if (request.developmentAdmission === "admitted") return "Sent to Development. Implementation still needs its own confirmation.";
            if (request.assessment?.startStage === "none") return request.assessment.summary;
            if (request.assessment?.stages.length === 1 && request.assessment.startStage === "sketch") {
                return "The design revision is saved. Review it before approving designs; this is not an implementation update.";
            }
            if (request.assessment?.stages.length === 1 && request.assessment.startStage === "requirements") {
                return "The Requirements update is saved. Answer any new or reopened questions before continuing.";
            }
            return "The requested changes are saved. Implementation and any remaining stage approvals are separate.";
    }
}

export function changeRequestActionLabel(request: ChangeRequest): string {
    if (!isDiscoveryChangeRequest(request)) return "View request";
    if (request.status === "proposed") return request.assessment?.question ? "Answer this question" : "Review this change";
    if (request.status === "reviewing") return "Continue draft review";
    if (request.status === "failed") return "Review failed request";
    return "View request";
}

export function changeRequestHistoryStatus(request: ChangeRequest): "running" | "waiting" | "success" | "error" {
    if (request.error || request.status === "failed") return "error";
    if (["queued", "analyzing", "active"].includes(request.status)) return "running";
    if (["proposed", "reviewing", "deferred"].includes(request.status)) return "waiting";
    return "success";
}
