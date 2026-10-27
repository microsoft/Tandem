import { Button, Disclosure, RadioGroup, Tabs, Textarea } from "./ui/index.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, CircleDot, ExternalLink, GitBranch, LoaderCircle, LockKeyhole, Plus, RefreshCw, Send, Sparkles } from "lucide-react";
import { Collapsible } from "radix-ui";
import { buildDecisionGraphMermaid } from "../decision-diagram.js";
import { decisionIsReady, requiresExplicitAnswer, type DecisionNode } from "../workflow.js";
import { Diagram } from "./diagram.js";
import { skippedStage, useAction, useDraft, useUi, type UiContextValue, type UiState } from "./ui-context.js";
import { requirementChange, requirementDraftKey, requirementNodes, selectedRequirement, wholeGraphDefaults } from "./requirements-model.js";
import { requirementsResearchIsCurrent } from "../requirements-research.js";
import { SubstageStatusIcon, type SubstageStatus } from "./substage-status.js";

interface AnswerDraft {
    choice: string;
    detail: string;
    version: number;
    error: string;
}

interface RequirementsProcessing {
    status?: string;
    action?: string;
    question?: { id?: string };
    message?: string;
    requestedAt?: string;
}

const processingTitles: Record<string, string> = {
    "add-usage": "Updating usage guidance",
    "generate-dag": "Researching usages and preparing questions",
    "answer-decision": "Applying your decision",
    "change-answer": "Revising dependent decisions",
    "apply-defaults": "Reconciling whole-graph defaults",
};

function initialAnswer(node: DecisionNode): AnswerDraft {
    const recommended = node.question?.recommended || "";
    return {
        choice: node.status === "active" && node.question?.choices.includes(recommended) ? recommended : "",
        detail: "",
        version: 0,
        error: "",
    };
}

function scopeIdentity(state: UiState): string {
    return JSON.stringify([
        state.prototypeId, state.generation, state.provider?.extensionId,
        state.provider?.source, state.provider?.canSubmitAnswers,
    ]);
}

function editable(ui: UiContextValue): boolean {
    return ui.state.lifecycle.currentStage === "requirements"
        && !skippedStage(ui.state, "requirements") && !ui.state.effortReset
        && ui.state.provider?.canSubmitAnswers !== false && ui.canEdit("requirements");
}

function writeGuidance(ui: UiContextValue): string {
    const skipped = skippedStage(ui.state, "requirements");
    if (skipped) return `Requirements is skipped. ${skipped.reason}`;
    if (ui.state.effortReset) return "Reset is pending. Finish or retry the reset before editing requirements.";
    if (ui.state.provider?.canSubmitAnswers === false) return ui.guidance("edit requirements");
    if (ui.state.lifecycle.currentStage !== "requirements") {
        return ui.state.lifecycle.currentStage === "prepare"
            ? "Finish Preparation to unlock Requirements."
            : "Requirements is read-only. Reopen this stage before changing its usages or decisions.";
    }
    return ui.guidance("edit requirements");
}

function ProcessingStatus({ processing }: { processing: RequirementsProcessing }) {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    const started = Date.parse(processing.requestedAt || "");
    const seconds = Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : null;
    return <div className="processing-state" role="status" aria-live="polite" aria-atomic="true">
        <LoaderCircle className="processing-indicator" size={20} aria-hidden="true" />
        <span className="processing-copy">
            <span className="processing-heading">
                <strong>{processingTitles[processing.action || ""] || "Processing Tandem update"}</strong>
                <span className="processing-dots" aria-hidden="true"><i /><i /><i /></span>
            </span>
            <span className="muted">{processing.message || "Waiting for a progress update."}</span>
            {seconds !== null && <span className="muted" role="timer" aria-live="off">
                {seconds < 60 ? `${seconds}s elapsed` : `${Math.floor(seconds / 60)}m ${seconds % 60}s elapsed`}
            </span>}
        </span>
    </div>;
}

interface QuestionProps {
    node: DecisionNode;
    nodes: DecisionNode[];
    draft: AnswerDraft;
    busy: boolean;
    canEdit: boolean;
    guidance: string;
    processing: RequirementsProcessing | null;
    onChange: (change: Partial<AnswerDraft>) => void;
    onSubmit: () => void;
}

function DecisionQuestion({ node, nodes, draft, busy, canEdit, guidance, processing, onChange, onSubmit }: QuestionProps) {
    const question = node.question;
    const changing = node.status === "answered";
    const blocked = !changing && !decisionIsReady(node, nodes);
    const disabled = busy || !canEdit || blocked;
    const dependencyNames = node.dependencies
        .filter((id) => !nodes.find((candidate) => candidate.id === id)?.answer)
        .map((id) => nodes.find((candidate) => candidate.id === id)?.title || id);

    return <>
        {changing && <>
            <p className="question">{question?.text || node.title}</p>
            <p className="muted">Answered</p>
            <div className="choice"><Check size={16} aria-hidden="true" /><span>{node.answer || "No answer recorded."}</span></div>
        </>}
        {processing?.status === "running" && <ProcessingStatus processing={processing} />}
        {processing?.status === "error" && <p className="processing-error" role="alert">
            {processing.message || "Tandem processing failed."}
        </p>}
        {node.review && <p className="processing-error" role="alert">
            Review required: {node.review.reason}
            {node.review.previousAnswer ? ` Previously selected: ${node.review.previousAnswer}` : ""}
        </p>}
        {requiresExplicitAnswer(node) && <p className="explicit-answer-notice">
            <strong>Explicit answer</strong> · Whole-graph defaults will skip this question.
        </p>}
        {blocked && <p className="provider-notice" role="status">
            To answer · {dependencyNames.length
                ? `Blocked until these prerequisites are answered: ${dependencyNames.join(", ")}.`
                : "No question is available for this decision."} You can review this question, but cannot answer it yet.
        </p>}
        {!canEdit && <p className="visually-hidden">{guidance}</p>}
        {!question && <p className="muted">No question is available for this decision.</p>}
        {question && !(changing && !canEdit) && <>
            <p className="question" id="decision-question-title" tabIndex={-1}>{changing ? "Change this answer" : question.text}</p>
            {question.rationale && !changing && <p className="rationale">{question.rationale}</p>}
            <form className="inline-composer" data-draft-key={requirementFormIdentity(node)} onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
                {question.choices.length > 0 && <RadioGroup.Root
                    className="choices"
                    name="prototype-choice"
                    aria-labelledby="decision-question-title"
                    value={draft.choice}
                    disabled={disabled}
                    onValueChange={(choice) => onChange({ choice, detail: "" })}
                >
                    {question.choices.map((choice, index) => <RadioGroup.Item presentation="choice"
                        className="choice"
                        key={`${index}:${choice}`}
                        value={choice}
                        data-ui-key={`decision:${question.id}:choice:${choice}`}
                        disabled={disabled}
                    >
                        <span className="choice-control" aria-hidden="true">
                            <RadioGroup.Indicator><Check size={16} /></RadioGroup.Indicator>
                        </span>
                        <span>{choice}</span>
                        {choice === question.recommended && !changing && <span className="recommended">Recommended</span>}
                    </RadioGroup.Item>)}
                </RadioGroup.Root>}
                {question.allowFreeText !== false && <Textarea
                    className="composer-input"
                    name="prototype-detail"
                    data-ui-key={`decision:${question.id}:detail`}
                    value={draft.detail}
                    maxLength={4000}
                    disabled={disabled}
                    aria-label="Additional answer context"
                    placeholder={changing ? "Enter a replacement answer" : question.answerPlaceholder
                        || (question.choices.length ? "Optional context" : "Enter your answer")}
                    onChange={(event) => {
                        const detail = event.currentTarget.value;
                        onChange({
                            detail,
                            choice: detail.trim() ? "" : question.choices.includes(question.recommended || "") ? question.recommended! : "",
                        });
                    }}
                />}
                <div className="actions">
                    <Button variant="primary"
                        id="decision-submit"
                        type="submit"
                        className="send"
                        disabled={disabled}
                        data-ui-key={`decision:${question.id}:send`}
                    >
                        <Send size={16} aria-hidden="true" />
                        {busy ? "Sending..." : !canEdit ? "Open installed Tandem to answer"
                            : blocked ? "Waiting for prerequisites" : changing ? "Update answer and dependents" : "Use this answer"}
                    </Button>
                    <p className="error" role="alert">{draft.error}</p>
                </div>
            </form>
        </>}
    </>;
}

function requirementFormIdentity(node: DecisionNode): string {
    return JSON.stringify([node.id, node.question, node.answer]);
}

export function RequirementsPanel({ reviewBaseline }: {
    reviewBaseline?: Pick<UiState, "requirements" | "decisionGraph">;
} = {}) {
    const ui = useUi();
    const { state, pending, browseStage } = ui;
    const action = useAction(`requirements:${state.prototypeId}:${state.generation}`);
    const [usageDraft, setUsageDraft] = useDraft("requirements:usage", { value: "", version: 0 });
    const [answerDrafts, setAnswerDrafts] = useDraft<Record<string, AnswerDraft>>("requirements:answers", {});
    const [usageError, setUsageError] = useState("");
    const [defaultsError, setDefaultsError] = useState("");
    const [activeAction, setActiveAction] = useState<"add-usage" | "generate-dag" | "answer" | "defaults" | null>(null);
    const [selection, setSelection] = useState<{ id: string | null; followActive: boolean }>({ id: null, followActive: true });
    const [usagesExpanded, setUsagesExpanded] = useDraft("requirements:accepted-usages-expanded", true);
    const [substageTab, setSubstageTab] = useDraft<"usage" | "dag" | null>("requirements:substage-tab", null);
    const [focusRequest, setFocusRequest] = useState(0);
    const [expandedQuestion, setExpandedQuestion] = useState<string | null>(null);
    const latest = useRef(ui);
    latest.current = ui;
    const mounted = useRef(true);
    const inFlight = useRef(false);
    const requestSequence = useRef(0);
    const requestScope = useRef(scopeIdentity(state));
    if (requestScope.current !== scopeIdentity(state)) {
        requestScope.current = scopeIdentity(state);
        requestSequence.current += 1;
    }
    const questionHost = useRef<HTMLDivElement>(null);
    const decisionList = useRef<HTMLOListElement>(null);
    const focusedRequest = useRef(0);
    const priorSubstage = useRef<{ identity: string; substage: string } | null>(null);
    const defaultsFollowUp = useRef<{ scope: string; revision: number } | null>(null);
    const nodes = useMemo(() => requirementNodes(state), [state.requirements, state.decisionGraph, state.question]);
    const graph = useMemo(() => buildDecisionGraphMermaid(nodes), [nodes]);
    const reviewChanges = useMemo(() => new Map(nodes.map(node => [node.id, reviewBaseline
        ? requirementChange(reviewBaseline.decisionGraph.nodes.find(before => before.id === node.id), node) : null] as const)),
    [nodes, reviewBaseline]);
    const changedQuestions = nodes.filter(node => reviewChanges.get(node.id));
    const firstReviewQuestion = changedQuestions.find(node => decisionIsReady(node, nodes))
        ?? nodes.find(node => node.status === "active") ?? changedQuestions.find(node => !node.answer) ?? changedQuestions[0];
    const selected = selectedRequirement(nodes, selection.id ?? (reviewBaseline ? firstReviewQuestion?.id ?? null : null),
        selection.id === null && reviewBaseline ? false : selection.followActive);
    const draftKey = selected ? requirementDraftKey(state, selected) : "";
    const draft = selected ? answerDrafts[draftKey] || initialAnswer(selected) : null;
    const isUsage = (state.requirements?.substage || (nodes.length ? "dag" : "usage")) === "usage";
    const usageItems = state.requirements?.usageItems || [];
    const addedUsages = reviewBaseline ? usageItems.filter(usage => !reviewBaseline.requirements.usageItems.includes(usage)) : [];
    const removedUsages = reviewBaseline?.requirements.usageItems.filter(usage => !usageItems.includes(usage)) ?? [];
    const usagesChanged = Boolean(reviewBaseline && JSON.stringify(usageItems) !== JSON.stringify(reviewBaseline.requirements.usageItems));
    const usageListLabel = reviewBaseline ? state.stageReviewStatus?.appliedAt ? "Applied usages"
        : state.stageReviewStatus?.discardedAt ? "Discarded draft usages" : "Draft usages" : "Accepted usages";
    const viewedSubstage = substageTab === "dag" && !nodes.length ? "usage"
        : substageTab ?? (isUsage || usagesChanged ? "usage" : "dag");
    const canEdit = editable(ui);
    const guidance = canEdit ? "" : writeGuidance(ui);
    const processing = state.processing as RequirementsProcessing | null;
    const workerBusy = processing?.status === "running";
    const busy = pending || action.busy || workerBusy;
    const suggestions = state.requirements?.suggestions || [];
    const research = state.requirements?.research;
    const researchIsCurrent = requirementsResearchIsCurrent(state);
    const suggestionsLoading = state.suggestionProcessing?.status === "running";
    const unsavedReview = Boolean(usageDraft.value.trim()) || nodes.some(node => {
        const saved = answerDrafts[requirementDraftKey(state, node)];
        return saved && (saved.choice !== initialAnswer(node).choice || Boolean(saved.detail.trim()));
    });
    useEffect(() => {
        ui.setReviewDirty?.("requirements", unsavedReview);
        return () => ui.setReviewDirty?.("requirements", false);
    }, [unsavedReview, ui.setReviewDirty]);
    const dagFailed = processing?.action === "generate-dag" && processing.status === "error";
    const defaultsFailed = processing?.action === "apply-defaults" && processing.status === "error";
    const defaultsRunning = activeAction === "defaults" || processing?.action === "apply-defaults" && workerBusy;
    const unanswered = nodes.filter((node) => !node.answer);
    const explicitQuestions = unanswered.filter(requiresExplicitAnswer);
    const hasDefaults = unanswered.some((node) => !requiresExplicitAnswer(node));
    const selectedProcessing = processing && (
        processing.question?.id === selected?.question?.id || processing.question?.id === selected?.id
        || processing.action === "apply-defaults"
    ) ? processing : null;

    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; requestSequence.current += 1; };
    }, []);

    useEffect(() => {
        const identity = JSON.stringify([state.prototypeId, state.generation]);
        if (state.lifecycle.currentStage !== "requirements") {
            priorSubstage.current = null;
            return;
        }
        const substage = isUsage ? "usage" : "dag";
        const generated = priorSubstage.current?.identity === identity
            && priorSubstage.current.substage === "usage" && substage === "dag";
        if (generated && (busy || processing?.status === "error")) return;
        priorSubstage.current = { identity, substage };
        if (generated && nodes.length) setSubstageTab("dag");
        if (!generated || !nodes.some((node) => node.status === "active")) return;
        setSelection({ id: null, followActive: true });
        browseStage("requirements");
        setFocusRequest((revision) => revision + 1);
    }, [state.prototypeId, state.generation, state.lifecycle.currentStage, isUsage, nodes, busy, processing?.status, browseStage]);

    useEffect(() => {
        const followUp = defaultsFollowUp.current;
        if (!followUp) return;
        if (followUp.scope !== scopeIdentity(state)) {
            defaultsFollowUp.current = null;
            return;
        }
        if (busy || state.revision <= followUp.revision) return;
        if (processing?.action !== "apply-defaults" || !["success", "error"].includes(processing.status || "")) return;
        defaultsFollowUp.current = null;
        if (processing.status === "error") return;
        setSelection({ id: null, followActive: true });
        setFocusRequest((revision) => revision + 1);
    }, [state, busy, processing]);

    useEffect(() => {
        if (!focusRequest || focusRequest === focusedRequest.current || busy) return;
        const target = questionHost.current?.querySelector<HTMLElement>(
            '[role="radio"][data-state="checked"]:not(:disabled), textarea:not(:disabled)',
        ) || questionHost.current?.querySelector<HTMLElement>("#decision-question-title");
        if (!target || target.closest("[hidden]")) return;
        focusedRequest.current = focusRequest;
        target.focus({ preventScroll: true });
        decisionList.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView?.({ block: "nearest" });
        questionHost.current?.scrollIntoView?.({ block: "nearest" });
    }, [focusRequest, draftKey, busy, viewedSubstage]);

    function stillCurrent(snapshot: UiState, sequence: number): boolean {
        return mounted.current && requestSequence.current === sequence
            && scopeIdentity(latest.current.state) === scopeIdentity(snapshot);
    }

    function available(): boolean {
        return mounted.current && !inFlight.current && !latest.current.pending
            && editable(latest.current) && latest.current.state.processing?.status !== "running";
    }

    function updateAnswer(key: string, node: DecisionNode, change: Partial<AnswerDraft>, edited = false) {
        setAnswerDrafts((all) => {
            const previous = all[key] || initialAnswer(node);
            return { ...all, [key]: { ...previous, ...change, version: previous.version + (edited ? 1 : 0) } };
        });
    }

    async function runMutation(
        kind: NonNullable<typeof activeAction>,
        work: (snapshot: UiState, sequence: number) => Promise<void>,
    ) {
        if (!available()) return;
        const snapshot = latest.current.state;
        const sequence = ++requestSequence.current;
        inFlight.current = true;
        setActiveAction(kind);
        try {
            await action.run(() => work(snapshot, sequence));
        } finally {
            if (mounted.current) {
                inFlight.current = false;
                setActiveAction(null);
            }
        }
    }

    async function submitUsage(kind: "add-usage" | "generate-dag", suggestion?: string) {
        if (!available() || latest.current.state.requirements?.substage === "dag") return;
        const captured = usageDraft;
        const answer = kind === "generate-dag"
            ? "Generate the requirements DAG from the complete usage list."
            : (suggestion ?? captured.value).trim();
        if (!answer || kind === "add-usage" && answer.length > 500) {
            setUsageError(!answer ? "Enter one usage sentence." : "Keep each usage within 500 characters.");
            return;
        }
        if (kind === "generate-dag" && !latest.current.state.requirements.usageItems.length) return;
        await runMutation(kind, async (snapshot, sequence) => {
            setUsageError("");
            try {
                await latest.current.post("/api/answer", { questionId: "usage-intake", answer, action: kind });
                if (!stillCurrent(snapshot, sequence)) return;
                if (kind === "add-usage" && suggestion === undefined) {
                    setUsageDraft((current) => current.version === captured.version && current.value === captured.value
                        ? { value: "", version: current.version + 1 } : current);
                }
            } catch (cause) {
                if (stillCurrent(snapshot, sequence)) setUsageError(cause instanceof Error ? cause.message : "Could not update requirements.");
            }
        });
    }

    async function submitAnswer() {
        if (!selected?.question || !draft || !available()
            || !selected.answer && !decisionIsReady(selected, nodes)) return;
        const node = selected;
        const captured = draft;
        const key = draftKey;
        const currentNode = requirementNodes(latest.current.state).find((candidate) => candidate.id === node.id);
        if (!currentNode || requirementDraftKey(latest.current.state, currentNode) !== key
            || !currentNode.answer && !decisionIsReady(currentNode, requirementNodes(latest.current.state))) return;
        const answer = captured.detail.trim() || captured.choice;
        if (!answer || answer.length > 4000) {
            updateAnswer(key, node, { error: !answer ? "Choose an option or enter an answer." : "Keep the answer within 4,000 characters." });
            return;
        }
        await runMutation("answer", async (snapshot, sequence) => {
            updateAnswer(key, node, { error: "" });
            try {
                await latest.current.post("/api/answer", {
                    questionId: node.question!.id,
                    answer,
                    action: node.status === "answered" ? "change-answer" : "answer-decision",
                    ...(snapshot.lifecycle.changeRequestId ? { expectedRequirementsDigest: snapshot.requirementsDigest } : {}),
                });
                if (!stillCurrent(snapshot, sequence)) return;
                setAnswerDrafts((all) => {
                    const current = all[key] || initialAnswer(node);
                    return current.version === captured.version && current.choice === captured.choice && current.detail === captured.detail
                        ? { ...all, [key]: { ...initialAnswer(node), version: current.version + 1 } } : all;
                });
                setSelection({ id: null, followActive: true });
            } catch (cause) {
                if (stillCurrent(snapshot, sequence)) {
                    updateAnswer(key, node, { error: cause instanceof Error ? cause.message : "Could not send answer." });
                }
            }
        });
    }

    async function applyDefaults(useCurrentSnapshot = false) {
        await runMutation("defaults", async (snapshot, sequence) => {
            setDefaultsError("");
            try {
                const plan = wholeGraphDefaults(snapshot, useCurrentSnapshot);
                if (plan.confirmation && !await latest.current.confirm(plan.confirmation, "Use whole-graph defaults")) return;
                if (!stillCurrent(snapshot, sequence)) return;
                if (!editable(latest.current) || latest.current.state.processing?.status === "running") {
                    setDefaultsError("Requirements is no longer editable. No defaults were submitted.");
                    return;
                }
                if (latest.current.state.revision !== snapshot.revision
                    || JSON.stringify(latest.current.state.decisionGraph) !== JSON.stringify(snapshot.decisionGraph)) {
                    setDefaultsError("Requirements changed while confirming. Review the current whole-graph defaults and try again.");
                    return;
                }
                defaultsFollowUp.current = { scope: scopeIdentity(snapshot), revision: snapshot.revision };
                await latest.current.post("/api/answer", plan.body);
                if (stillCurrent(snapshot, sequence)) setSelection({ id: null, followActive: true });
            } catch (cause) {
                if (stillCurrent(snapshot, sequence)) {
                    defaultsFollowUp.current = null;
                    setDefaultsError(cause instanceof Error ? cause.message : "Could not reconcile whole-graph defaults.");
                }
            }
        });
    }

    function selectDecision(id: string) {
        const node = nodes.find((candidate) => candidate.id === id);
        if (node) setSelection({ id: node.id, followActive: node.status === "active" });
    }

    const usageMessage = usageError || (!canEdit ? guidance
        : dagFailed ? `${processing?.message || "The requirements DAG could not be generated."} Your usages are saved. Retry requirements DAG to continue.`
            : activeAction === "generate-dag" ? "Researching relevant missing facts before generating your questions..."
                : activeAction === "add-usage" ? "Adding usage and generating suggestions..."
                    : workerBusy && isUsage ? state.status || "Updating requirements..."
                        : suggestionsLoading && isUsage ? usageItems.length
                            ? "Usage saved. Suggestions are refreshing; you can keep adding usages."
                            : "Starter suggestions are loading; you can add a usage now."
                            : isUsage ? usageItems.length ? "Add another usage or generate the decision DAG."
                                : "Add the first usage to receive AI suggestions."
                                : "Usage collection is complete. Work through the dynamic DAG.");
    const graphStatus = defaultsError || action.error || (defaultsRunning
        ? "Saving whole-graph defaults. Only the approved snapshot will be applied."
        : defaultsFailed ? processing?.message || "Whole-graph default reconciliation failed."
            : nodes.length && !unanswered.length ? "All requirements decisions are answered."
                : unanswered.length && !nodes.some((node) => node.status === "active")
                    ? "The remaining decisions are blocked. Review their prerequisites before continuing."
                    : explicitQuestions.length ? `${explicitQuestions.length} ${explicitQuestions.length === 1 ? "question needs" : "questions need"} an explicit answer. Whole-graph defaults will skip ${explicitQuestions.length === 1 ? "it" : "them"}.` : "");

    const usageStatusLabel = isUsage ? "Collecting usages" : "Usage list complete";
    const [dagStatus, dagStatusLabel]: [SubstageStatus, string] = dagFailed ? ["failed", "Generation failed - retry available"]
        : activeAction === "generate-dag" || workerBusy && processing?.action === "generate-dag" ? ["running", "Generating requirements DAG"]
            : !nodes.length ? ["locked", "Complete the usage list to unlock the decision DAG"]
                : !unanswered.length ? ["ready", "All decisions answered"] : ["active", "Decisions to answer"];
    const usageRows = usageItems.map((usage, index) => <li className="usage-item" key={`${index}:${usage}`}
        data-change={reviewBaseline ? addedUsages.includes(usage) ? "added" : "retained" : undefined}>
        <span>{index + 1}. {usage}</span>
        {reviewBaseline && <span className="requirement-change-badge">{addedUsages.includes(usage) ? "Added" : "Existing"}</span>}
    </li>);

    return <Tabs.Root className="requirements-workspace" value={viewedSubstage} onValueChange={(value) => {
        if (value === "usage" || value === "dag") setSubstageTab(value);
    }}>
        <Tabs.Bar>
        <Tabs.List className="preview-tabs requirements-substages" aria-label="Requirements substages">
            <Tabs.Trigger id="usage-substage" value="usage" className="preview-tab requirements-substage substage-tab"
                aria-label={`Usage list, ${usageStatusLabel}${usagesChanged ? ", changed" : ""}`}
                data-status={isUsage ? "active" : "complete"} aria-controls="requirements-usage-panel">
                <span className="substage-index" aria-hidden="true">1</span><span>Usage list</span>
                <SubstageStatusIcon status={isUsage ? "active" : "ready"} label={usageStatusLabel} />
            </Tabs.Trigger>
            <Tabs.Trigger id="dag-substage" value="dag" className="preview-tab requirements-substage substage-tab"
                aria-label={`Decision DAG, ${dagStatusLabel}${changedQuestions.length ? `, ${changedQuestions.length} new or changed questions` : ""}`}
                data-status={isUsage ? "locked" : "active"} disabled={!nodes.length} aria-controls="requirements-dag-panel">
                <span className="substage-index" aria-hidden="true">2</span><span>Decision DAG</span>
                <SubstageStatusIcon status={dagStatus} label={dagStatusLabel} />
            </Tabs.Trigger>
        </Tabs.List>
        </Tabs.Bar>
        <Tabs.Content id="requirements-usage-panel" value="usage" forceMount hidden={viewedSubstage !== "usage"}
            className="requirements-usage-panel" aria-labelledby="usage-substage">
        <section id="requirements-substage-section" className="section requirements-intake-panel" aria-label="Requirements" aria-describedby="usage-message" data-substage={isUsage ? "usage" : "dag"}>
            <div className="requirements-intake-heading"><p className="eyebrow"><GitBranch size={14} aria-hidden="true" />Requirements</p></div>
            <div id="usage-intake" className="usage-intake" hidden={!isUsage}>
                <div className="usage-entry">
                <h2 className="usage-title">What should this help you do?</h2>
                <p id="usage-help" className="visually-hidden">Add one goal at a time. Start with your own, or choose a suggestion below.</p>
                <ul id="usage-items" className="usage-items">
                    {usageItems.length ? usageRows
                        : <li className="muted">No usages added yet.</li>}
                </ul>
                <form id="usage-form" className="usage-form inline-composer" onSubmit={(event) => { event.preventDefault(); void submitUsage("add-usage"); }}>
                    <Textarea
                        className="composer-input"
                        id="usage-input"
                        value={usageDraft.value}
                        onChange={(event) => {
                            const value = event.currentTarget.value;
                            setUsageDraft((current) => ({ value, version: current.version + 1 }));
                        }}
                        rows={2}
                        maxLength={500}
                        autoComplete="off"
                        placeholder="I want to..."
                        aria-label="Add one app usage"
                        aria-describedby="usage-help usage-message"
                        disabled={busy || !canEdit || !isUsage}
                    />
                    <Button variant="primary" id="add-usage" type="submit" disabled={busy || !canEdit || !isUsage} aria-describedby="usage-help usage-message">
                        <Plus size={16} aria-hidden="true" />{busy ? "Working..." : "Add usage"}
                    </Button>
                </form>
                <Button variant="primary" id="generate-dag" className="generate-dag" type="button" disabled={busy || !canEdit || !usageItems.length || !isUsage}
                    aria-describedby="usage-message"
                    data-status-help="Research relevant missing facts for your accepted usages, then generate questions. Findings do not accept decisions or add features."
                    onClick={() => void submitUsage("generate-dag")}>
                    {dagFailed ? <RefreshCw size={16} aria-hidden="true" /> : <GitBranch size={16} aria-hidden="true" />}
                    {activeAction === "generate-dag" || processing?.action === "generate-dag" && workerBusy
                        ? "Generating DAG..." : dagFailed ? "Retry requirements DAG" : "Generate requirements DAG"}
                </Button>
                </div>
                <aside id="usage-suggestion-area" aria-label="Suggested usages" hidden={!suggestions.length && !suggestionsLoading}>
                    <p className="usage-suggestion-heading"><Sparkles size={16} aria-hidden="true" /> AI suggestions</p>
                    <ul id="usage-suggestions" className="usage-suggestions">
                        {suggestionsLoading && !suggestions.length && <li className="muted">Generating AI suggestions...</li>}
                        {suggestions.map((suggestion, index) => <li key={`${index}:${suggestion}`}>
                            <Button variant="item" className="usage-suggestion" type="button" disabled={busy || !canEdit || !isUsage}
                                data-status-help="Add this suggestion to the accepted usage list."
                                onClick={() => void submitUsage("add-usage", suggestion)}>
                                <Plus size={15} aria-hidden="true" /><span>{suggestion}</span>
                            </Button>
                        </li>)}
                    </ul>
                </aside>
            </div>
            {!isUsage && <Collapsible.Root open={usagesExpanded} onOpenChange={setUsagesExpanded}>
                <Collapsible.Trigger asChild><Button variant="item" className="usage-suggestion" type="button">
                    <ChevronDown size={16} aria-hidden="true" />{usageListLabel} ({usageItems.length})
                </Button></Collapsible.Trigger>
                <Collapsible.Content>
                    <ul className="usage-items" aria-label={usageListLabel}>
                        {usageRows}
                        {!usageItems.length && <li className="muted">No usages recorded.</li>}
                    </ul>
                </Collapsible.Content>
            </Collapsible.Root>}
            {removedUsages.length > 0 && <>
                <p className="eyebrow">Removed usages</p>
                <ul className="usage-items" aria-label="Removed usages">
                    {removedUsages.map(usage => <li className="usage-item" key={usage} data-change="removed">
                        <span>{usage}</span><span className="requirement-change-badge">Removed</span>
                    </li>)}
                </ul>
            </>}
            {usagesChanged && !addedUsages.length && !removedUsages.length && <p className="muted">Usage order changed. The previous order is available in Details.</p>}
            {reviewBaseline && nodes.length > 0 && (changedQuestions.length > 0 || unanswered.length > 0) && <Button
                variant="secondary" id="review-requirement-questions" type="button" onClick={() => {
                    setSubstageTab("dag");
                    setSelection({ id: null, followActive: true });
                    setFocusRequest(revision => revision + 1);
                }}>
                <ArrowRight size={16} aria-hidden="true" />{unanswered.length
                    ? `Review questions (${unanswered.length} to answer)` : `Review question changes (${changedQuestions.length})`}
            </Button>}
            <p id="usage-message" className={usageError || dagFailed || activeAction || workerBusy || suggestionsLoading ? "usage-message" : "visually-hidden"} role={usageError || dagFailed ? "alert" : "status"} aria-live="polite"
                data-status={usageError || dagFailed ? "error" : "idle"}>{usageMessage}</p>
        </section>
        {research && <Disclosure id="requirements-research" className="section" open>
            <summary>{researchIsCurrent ? "Research and sources" : "Earlier research and sources"}</summary>
            {!researchIsCurrent && <p className="muted">These findings belong to earlier inputs and are retained for reference.</p>}
            <p>{research.summary}</p>
            {!!research.checks.length && <div className="preparation-result-list">
                {research.checks.map((check, index) => <div className="preparation-result-item" key={`${index}:${check.label}`} data-status={check.status}>
                    <strong>{check.label} · {check.status}</strong><span>{check.detail}</span>
                </div>)}
            </div>}
            <div className="preparation-result-sources">
                {research.sources.map((source, index) => <a key={`${index}:${source.url}`} href={source.url}
                    target="_blank" rel="noreferrer" title={source.purpose || source.url}>
                    {source.title} <ExternalLink size={14} aria-hidden="true" />
                </a>)}
                {!research.sources.length && <p className="muted">No external sources recorded.</p>}
            </div>
        </Disclosure>}
        </Tabs.Content>
        <Tabs.Content id="requirements-dag-panel" value="dag" forceMount hidden={viewedSubstage !== "dag"}
            className="requirements-dag-panel" aria-labelledby="dag-substage">
        <div id="design-tree-card" className="design-tree-card" hidden={!nodes.length}>
            <div className="design-tree-heading">
                <div className="design-tree-location">
                    <p id="design-tree-current" className="eyebrow"><GitBranch size={14} aria-hidden="true" />{selected
                        ? `${selected.status === "active" ? "Active" : selected.status === "answered" ? "Answered"
                            : decisionIsReady(selected, nodes) ? "Ready to answer" : "To answer"} · ${selected.title}`
                            + (nodes.some((node) => node.status === "toAnswer") ? ` · ${nodes.filter((node) => node.status === "toAnswer").length} to answer` : "")
                        : "Waiting for the active decision..."}</p>
                </div>
                {!state.lifecycle.completedStages.includes("requirements") && <span id="design-tree-phase" className="design-tree-phase">
                    {state.requirements.substage === "usage" ? "Collecting usages" : "Requirements decisions"}
                </span>}
            </div>
            <div className="design-tree-body">
                {nodes.length > 0 && <div className="design-tree-host">
                    <Diagram id="design-tree-host" source={graph.source}
                        onNodeSelect={(alias) => selectDecision(graph.aliases.get(alias)?.id || alias)}
                        legend={<div className="design-tree-legend" aria-label="Decision status legend">
                            <span><i className="answered" aria-hidden="true" />Answered</span>
                            <span><i className="active" aria-hidden="true" />Active</span>
                            <span><i className="to-answer" aria-hidden="true" />To answer</span>
                            <span><i className="explicit-answer" aria-hidden="true" />Explicit answer</span>
                        </div>}
                        label="Requirements decision DAG" />
                </div>}
                <div className="decision-list-pane" role="region" aria-label="Requirement decision list" tabIndex={0}>
                    <ol id="decision-list" className="decision-list" aria-label="Requirement decisions" ref={decisionList}>
                        {nodes.map((node) => <li key={node.id}>
                            <Button variant="item" type="button" data-ui-key={`decision-text:${node.id}`} data-decision-id={node.id}
                                data-explicit-answer={requiresExplicitAnswer(node) || undefined}
                                data-change={reviewChanges.get(node.id) || undefined}
                                data-status={node.status} aria-pressed={node.id === selected?.id} onClick={() => selectDecision(node.id)}>
                                {node.status === "answered" ? <Check size={15} aria-hidden="true" /> : decisionIsReady(node, nodes)
                                    ? <CircleDot size={15} aria-hidden="true" /> : <LockKeyhole size={15} aria-hidden="true" />}
                                <span>{node.title} · {node.status === "toAnswer"
                                    ? decisionIsReady(node, nodes) ? "Ready to answer" : "To answer" : node.status}
                                    {node.review ? " · Review required" : ""}</span>
                                {reviewChanges.get(node.id) && <span className="requirement-change-badge">
                                    {reviewChanges.get(node.id) === "added" ? "New" : "Changed"}
                                </span>}
                                {requiresExplicitAnswer(node) && <span className="explicit-answer-badge">Explicit answer</span>}
                            </Button>
                        </li>)}
                    </ol>
                    <p id="design-tree-status" className="diagram-status" role={defaultsError || action.error || defaultsFailed ? "alert" : "status"}
                        aria-live="polite" data-status={defaultsError || action.error || defaultsFailed ? "error" : "idle"}>{graphStatus}</p>
                </div>
            </div>
            <aside className="design-tree-inspector" aria-label="Selected decision" tabIndex={0} data-status-help={guidance}>
                <p className="eyebrow">{selected && reviewChanges.get(selected.id)
                    ? reviewChanges.get(selected.id) === "added" ? "New question" : "Changed question"
                    : reviewBaseline && selected?.answer ? "Existing question - answer retained" : "Selected question"}</p>
                <div id="question-host" className="question-card" ref={questionHost}
                    data-composer-expanded={expandedQuestion === draftKey || undefined}
                    onFocusCapture={() => setExpandedQuestion(draftKey)}>
                    {selected && draft ? <DecisionQuestion
                        key={draftKey}
                        node={selected}
                        nodes={nodes}
                        draft={draft}
                        busy={busy}
                        canEdit={canEdit}
                        guidance={guidance}
                        processing={selectedProcessing}
                        onChange={(change) => updateAnswer(draftKey, selected, change, true)}
                        onSubmit={() => void submitAnswer()}
                    /> : <p className="muted">The active decision will appear here.</p>}
                    {(unanswered.length > 0 || defaultsFailed || defaultsRunning) && <div className="actions">
                        <Button variant="secondary" className="all-recommended" type="button" disabled={busy || !canEdit || !hasDefaults && !defaultsFailed}
                            data-ui-key={`decision:${selected?.question?.id || "graph"}:recommended`}
                            title="Approve the currently displayed recommended choices for ALL unanswered decisions with recommendations, including downstream nodes, in one reconciled batch. Questions marked Explicit answer are skipped. Changed decisions require review."
                            onClick={() => void applyDefaults()}>
                            <Sparkles size={16} aria-hidden="true" />
                            {defaultsRunning ? "Saving whole-graph defaults..." : defaultsFailed ? "Retry whole-graph defaults" : "Use whole-graph defaults"}
                        </Button>
                        {defaultsFailed && <Button variant="secondary" type="button" className="review-current-defaults" disabled={busy || !canEdit || !hasDefaults}
                            title="Replace the failed batch only after approving a fresh snapshot of every current recommendation."
                            onClick={() => void applyDefaults(true)}>
                            <RefreshCw size={16} aria-hidden="true" />Review current whole-graph defaults
                        </Button>}
                    </div>}
                    {selected?.status !== "active" && nodes.some((node) => node.status === "active") && <Button variant="secondary" type="button"
                        className="next-decision" onClick={() => setSelection({ id: null, followActive: true })}>
                        <ArrowRight size={16} aria-hidden="true" />Go to next unresolved decision
                    </Button>}
                </div>
            </aside>
        </div>
        <div id="design-tree-empty" className="visually-hidden" hidden={nodes.length > 0}>
            <p>The requirements DAG will appear after the usage list is captured.</p>
        </div>
        </Tabs.Content>
    </Tabs.Root>;
}
