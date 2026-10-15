import { renderHumanLoop, humanLoopStatusLabel, renderCycleProgress } from './renderers/human-loop.js';
import { createConversationRenderer } from './renderers/conversation.js';
import { projectHumanHistory } from './renderers/human-loop-history.js';
import { createSharedDesignView } from './renderers/shared-design.js';
import { createAnnotationController } from './annotation-controller.js';
import { installBrowserLinkNavigation } from './link-navigation.js';
import { installComposerEnter } from './composer-enter.js';
import { installComposerImage } from './composer-image.js';
import { renderPermissionRequests } from './permission-presentation.js';
import { renderBackgroundProcesses } from './background-processes.js';
import { createWorkflowStopControl } from './workflow-stop-control.js';
import { installPanelSplitter } from './panel-splitter.js';
import { createImplementationConfirmations } from './implementation-confirmation.js';
import { installProjectPresentation } from './project-presentation.js';
import { currentHandoffActivity, quietHandoff } from './handoff-presentation.js';
import { projectOutputs } from './project-outputs.js';
import { parseRoleMention } from './role-hint.js';
import { createQueuedRequests } from './queued-requests.js';

const $ = (id) => document.getElementById(id);
const splitter = installPanelSplitter({ layout: document.querySelector('.human-layout'),
  design: $('design-panel'), separator: $('workspace-divider'), resized: width => projectPresentation?.resized(width) });
window.addEventListener('pagehide', event => { if (!event.persisted) splitter.dispose(); });
const darkPreference = matchMedia('(prefers-color-scheme: dark)');
function updateBranding() {
  const preference = document.body.dataset.theme;
  const hostMode = document.documentElement.dataset.colorMode ?? document.body.dataset.colorMode;
  const mode = ['light', 'dark'].includes(preference) ? preference
    : ['light', 'dark'].includes(hostMode) ? hostMode : darkPreference.matches ? 'dark' : 'light';
  const image = document.querySelector('.brand-mark');
  const source = `branding/tandem-blue-${mode}.png`;
  if (image.getAttribute('src') !== source) image.setAttribute('src', source);
}
const brandingObserver = new MutationObserver(updateBranding);
for (const target of [document.documentElement, document.body]) {
  brandingObserver.observe(target, { attributes: true, attributeFilter: ['data-theme', 'data-color-mode'] });
}
darkPreference.addEventListener('change', updateBranding);
updateBranding();
let snapshot, designDigest = null, refreshing = null, sending = false, pending = null;
let pendingSubmitted = false, pendingPreviewUrl = null, pendingClipboardId = null;
let stopRequest = null, stopAttempt = null;
let controlsConnected = false;
let initialCreationConfirmation = null;
let initialCreationInspecting = false;
let emptySetupConfirmation = null, emptySetupBusy = false;
let installationNotice = null;
const answerPending = new Map();
const notice = (text) => { $('notice').textContent = text ?? ''; $('notice').hidden = !text; };
const stopControl = createWorkflowStopControl({
  container: $('workflow-stop-control'), primary: $('stop-current-flow'), toggle: $('stop-options'),
  menu: $('stop-options-menu'), immediate: $('stop-now'),
}, mode => requestWorkflowStop(mode), error => notice(error.message));
const renderStopControl = () => stopControl.render(snapshot?.workflow, { connected: controlsConnected, pending: Boolean(stopRequest) });
const make = (tag, text) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
let settingsBusy = false, settingsLoaded = false, settingsLoading = null, settingsVersion = 0;
let settingsModel = null, effortModel = null;
let selectedOutput = null;
let pendingOutputFocus = null;
let lastVerifiedDesign = null;
if (document.body.dataset.projectPanel) $('design-overview').open = false;
const projectPresentation = installProjectPresentation({ document, window,
  changed: () => { if (snapshot) render(); },
  settings: () => { $('canvas-settings').open = true; $('setting-theme').focus(); void refreshSettings(); },
  effortChanged: () => { void refreshSettings(true); },
  layoutChanged: layout => splitter.setProjectLayout(layout),
  hasAttachments: () => $('annotation-preview')?.hidden === false || $('clipboard-preview')?.hidden === false,
  openOutput,
  outputSelection: () => selectedOutput ?? (designView.current() ? { id: `design:${designView.current().artifactId}`,
    binding: JSON.stringify(snapshot.design?.binding ?? lastVerifiedDesign?.binding) } : null),
  currentWork: () => $('focus-current-message').click(),
});
function renderReasoningEffort() {
  const id = $('setting-model').value, model = settingsModel;
  const selected = model?.effortManaged ? model.projectReasoningEffort ?? model.actualReasoningEffort ?? '' : effortModel === id ? $('setting-effort').value
    : model?.pending === id ? model.pendingReasoningEffort : model?.desired === id ? model.desiredReasoningEffort : '';
  const levels = model?.models.find(item => item.id === id)?.supportedReasoningEfforts ?? [];
  const unset = make('option', 'No explicit override'); unset.value = '';
  $('setting-effort').replaceChildren(unset, ...levels.map(level => {
    const option = make('option', level); option.value = level; return option;
  }));
  $('setting-effort').value = levels.includes(selected) ? selected : '';
  $('setting-effort').disabled = Boolean(model?.effortManaged) || settingsBusy || !model?.canChange || !model.canSetReasoningEffort || !levels.length;
  effortModel = id;
}
function settingsError(error) {
  $('settings-error').textContent = error?.message ?? '';
  $('settings-error').hidden = !error;
}
function applySettings(value, preserveAppearanceDraft = false) {
  const preferences = value.preferences, model = value.model;
  document.body.dataset.theme = preferences.theme;
  document.body.dataset.fontSize = preferences.fontSize;
  projectPresentation?.appearance(preferences);
  if (!preserveAppearanceDraft) {
    $('setting-theme').value = preferences.theme;
    $('setting-font').value = preferences.fontSize;
  }
  const desired = $('setting-model').value;
  $('setting-model').replaceChildren(...model.models.map(({ id, name }) => {
    const option = make('option', name); option.value = id; return option;
  }));
  if (!model.models.length || !model.actual && !model.pending && !model.desired) {
    const option = make('option', model.models.length ? 'Choose a private model' : 'Unavailable until verified'); option.value = '';
    $('setting-model').prepend(option);
  }
  $('setting-model').value = model.models.some(({ id }) => id === desired) ? desired : model.pending ?? model.actual ?? model.desired ?? '';
  settingsModel = model;
  renderReasoningEffort();
  $('setting-model').disabled = settingsBusy || !model.canChange;
  $('apply-model').disabled = settingsBusy || !model.canChange || !$('setting-model').value;
  $('accept-actual-model').hidden = !model.pending && !model.error;
  $('accept-actual-model').disabled = settingsBusy || !model.canChange || !model.actual;
  $('model-setting-status').textContent = [
    `Actual private model: ${model.actual ?? 'not yet verified'}.`,
    `Actual reasoning effort: ${model.actualReasoningEffort ?? 'not explicitly reported'}.`,
    model.effortManaged ? `Reasoning effort is controlled by the project effort control (${model.projectReasoningEffort ?? 'no shared choice yet'}).` : '',
    model.desired ? `Saved selection: ${model.desired}.` : '',
    model.desiredReasoningEffort ? `Saved reasoning effort: ${model.desiredReasoningEffort}.` : '',
    model.pending ? `Pending selection: ${model.pending}.` : '',
    model.pendingReasoningEffort ? `Pending reasoning effort: ${model.pendingReasoningEffort}.` : '',
    model.error, model.reason,
    model.capabilities ? `Diagram images: ${model.capabilities.supported ? 'supported' : model.capabilities.reason ?? 'not supported'}.` : '',
    'This setting never changes the main chat model.',
  ].filter(Boolean).join(' ');
  settingsLoaded = true;
}
function refreshSettings(preserveAppearanceDraft = false) {
  if (settingsLoading) return settingsLoading;
  const version = settingsVersion;
  settingsLoading = (async () => {
    const response = await fetch('/api/settings'), value = await response.json();
    if (!response.ok) throw new Error(value.error ?? 'Settings could not be read.');
    if (version === settingsVersion && !settingsBusy) applySettings(value, preserveAppearanceDraft);
  })().catch((error) => { if (version === settingsVersion && !settingsBusy) settingsError(error); }).finally(() => { settingsLoading = null; });
  return settingsLoading;
}
async function saveSettings(path, data) {
  if (settingsBusy) return;
  settingsBusy = true; settingsVersion++; settingsError(null);
  for (const id of ['save-appearance', 'apply-model', 'accept-actual-model', 'setting-model', 'setting-effort']) $(id).disabled = true;
  try {
    const value = await post(path, data);
    if (path === '/api/settings/model') effortModel = null;
    applySettings(value);
  }
  catch (error) { settingsError(error); }
  finally {
    settingsBusy = false; $('save-appearance').disabled = false;
    await settingsLoading;
    await refreshSettings(); await refresh();
  }
}
$('canvas-settings').addEventListener('toggle', () => { if ($('canvas-settings').open) void refreshSettings(); });
function closeSettings() {
  $('canvas-settings').open = false;
  if (projectPresentation) projectPresentation.settingsClosed();
  else $('canvas-settings').querySelector('summary').focus();
}
$('close-settings').onclick = closeSettings;
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !event.defaultPrevented && $('canvas-settings').open && !document.querySelector('dialog[open]')) {
    event.preventDefault(); closeSettings();
  }
});
$('save-appearance').onclick = () => saveSettings('/api/settings', { theme: $('setting-theme').value, fontSize: $('setting-font').value });
$('apply-model').onclick = () => saveSettings('/api/settings/model', { action: 'select', model: $('setting-model').value,
  reasoningEffort: $('setting-effort').value || null });
$('setting-model').onchange = () => {
  renderReasoningEffort();
  $('apply-model').disabled = settingsBusy || $('setting-model').disabled || !$('setting-model').value;
};
$('accept-actual-model').onclick = () => saveSettings('/api/settings/model', { action: 'accept-actual', model: null });
const questionArtifact = make('section');
const cycleArtifact = make('section');
cycleArtifact.id = 'human-cycle-progress';
cycleArtifact.className = 'human-loop';
cycleArtifact.setAttribute('aria-label', 'Implementation cycle progress');
questionArtifact.className = 'human-loop';
questionArtifact.setAttribute('aria-label', 'Workflow questions');
$('questions-content').append(questionArtifact);
let questionFocus = null, designFocus = null, designScroll = [], designInert = [];
const designChildren = [...$('design-panel').children].filter(node => node !== $('question-panel'));
document.addEventListener('focusin', event => {
  if ($('questions-content').contains(event.target)) questionFocus = event.target;
  else if ($('design-panel').contains(event.target) && !$('question-panel').contains(event.target)
    && event.target !== $('return-to-questions')) designFocus = event.target;
});
function showQuestions() {
  projectPresentation?.showDesign();
  if ($('question-panel').hidden) {
    designInert = designChildren.map(node => [node, node.inert]);
    designScroll = designChildren.flatMap(node => [node, ...node.querySelectorAll('*')])
      .filter(node => node.scrollTop || node.scrollLeft).map(node => [node, node.scrollTop, node.scrollLeft]);
  }
  $('design-panel').dataset.workspaceView = 'questions';
  for (const node of designChildren) node.inert = true;
  $('question-panel').hidden = false;
  $('show-questions').setAttribute('aria-expanded', 'true');
  const target = questionFocus?.isConnected && questionFocus.getClientRects().length && !questionFocus.disabled
    ? questionFocus : questionArtifact.querySelector('.question-open-list button[aria-current="true"]')
      ?? questionArtifact.querySelector('.question-open-list button')
      ?? questionArtifact.querySelector('.question-history:not([hidden]) > summary') ?? $('questions-back');
  target.focus({ preventScroll: true });
  if (matchMedia('(max-width: 660px)').matches || document.body.dataset.projectStacked === 'true') {
    $('question-panel').scrollIntoView({ block: 'start' });
  }
}
function closeQuestions({ focus = false } = {}) {
  const wasOpen = !$('question-panel').hidden;
  delete $('design-panel').dataset.workspaceView;
  if (wasOpen) for (const [node, inert] of designInert) node.inert = inert;
  $('question-panel').hidden = true;
  $('show-questions').setAttribute('aria-expanded', 'false');
  $('return-to-questions').hidden = true;
  if (wasOpen) for (const [node, top, left] of designScroll) { node.scrollTop = top; node.scrollLeft = left; }
  if (focus) (designFocus?.isConnected && designFocus.getClientRects().length ? designFocus : $('show-questions')).focus({ preventScroll: true });
}
const conversation = createConversationRenderer({ messages: $('messages'), history: $('state-history'),
  current: $('current-state'), currentDetail: $('current-detail'), newer: $('newer'),
  canFollowMessages: () => !$('messages').contains(document.activeElement)
    && !snapshot?.workflow?.questionInteractions.some(group => group.canAnswer
      && group.questions.some(question => question.state === 'open' && question.blockingActive)),
  onSelectState: transition => { $('history-details')?.remove(); queuedRequests.focusRequest(transition.source?.requestId); } });
const queuedRequests = createQueuedRequests($('queued-requests'));
let annotation;
const designView = createSharedDesignView({ tabs: $('backbone-tabs'), mount: $('design-artifacts'),
  onChange: () => {
    annotation?.refresh();
    if ($('project-output-view').hidden) selectedOutput = null;
    if (snapshot) projectPresentation?.publish(snapshot);
  }, onAnnotate: (id) => annotation.toggleArtifact(id) });
annotation = createAnnotationController({
  panel: $('design-panel'), artifactMode: true,
  getView: () => designView.current(), selectArtifact: (id) => designView.selectArtifact(id),
  getArtifactLabel: (id) => designView.label(id), getCandidates: () => designView.candidates(),
  controls: { parking: $('annotation-parking'), tools: $('annotation-tools'), status: $('annotation-status'),
    reset: $('annotation-reset'), capture: $('annotation-capture'), remove: $('annotation-remove'),
    image: $('annotation-image'), preview: $('annotation-preview'), caption: $('annotation-caption') },
});
function inspectReference(binding, reference) {
  projectPresentation?.showDesign();
  try { designView.inspectReference(binding, reference); showOriginalDesign(); }
  catch (error) { notice(error.message); }
}
function showOriginalDesign() {
  closeQuestions();
  selectedOutput = null;
  pendingOutputFocus = null;
  $('project-output-view').hidden = true;
  $('canvas-scroll').hidden = false;
  $('design-pane-title').textContent = 'Canvas';
  if (snapshot) projectPresentation?.publish(snapshot);
}
function openOutput(item, source) {
  closeQuestions();
  if (item.target.kind === 'design') {
    showOriginalDesign();
    designView.selectArtifact(item.target.artifactId);
  } else if (item.target.kind === 'message') {
    showOriginalDesign();
    conversation.focusEntry(item.target.entryId);
  } else {
    const cycle = source.cycles?.find(cycle => cycle.id === item.target.cycleId)
      ?? (source.workflow.currentCycle?.id === item.target.cycleId ? source.workflow.currentCycle : null);
    if (!cycle) throw new Error('The selected work cycle is no longer available.');
    const mount = $('project-output-view');
    const back = make('button', 'Back to Design'); back.type = 'button'; back.onclick = showOriginalDesign;
    const history = make('button', 'Show original request'); history.type = 'button';
    history.onclick = () => conversation.focusEntry(`request:${cycle.originRequestId}`);
    const heading = make('div'); heading.className = 'project-output-actions'; heading.append(back, history);
    const content = make('section'); content.className = 'human-loop';
    renderCycleProgress(content, cycle, inspectReference);
    content.querySelector('details').open = true;
    mount.replaceChildren(heading, make('p', item.detail), content);
    mount.hidden = false; $('canvas-scroll').hidden = true;
    $('design-pane-title').textContent = item.group;
    pendingOutputFocus = item.group === 'Implementation' ? content.querySelector('[data-implementation-result]') : mount;
    focusProjectOutput();
  }
  selectedOutput = { id: item.id, binding: item.binding };
}
function focusProjectOutput() {
  if (!pendingOutputFocus?.isConnected || document.body.dataset.projectDesign !== 'true') return;
  pendingOutputFocus.scrollIntoView({ block: 'nearest' });
  pendingOutputFocus.focus({ preventScroll: true });
  pendingOutputFocus = null;
}

async function post(path, data, expectedStatus) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error ?? `Request failed (${response.status}).`),
    { notAccepted: value.notAccepted === true, accepted: value.accepted === true });
  if (expectedStatus !== undefined && response.status !== expectedStatus) throw new Error('Request acceptance was not confirmed; refresh before retrying.');
  return value;
}
let linkNotice = null;
let compactionRequest = null, compactionRequesting = false;
installBrowserLinkNavigation(document, {
  surface: document.body.dataset.tandemSurface ?? 'canvas',
  open: async (url, { focus }) => {
    if (linkNotice && $('notice').textContent === linkNotice) notice('');
    linkNotice = null;
    const result = await post('/api/navigation/open', { url, focus });
    if (result.opened !== true || typeof result.instanceId !== 'string' || !result.instanceId) {
      throw new Error('The Host did not confirm browser opening. Inspect the Browser before trying again.');
    }
    return result;
  },
  onError: (error) => { linkNotice = `Link was not opened: ${error.message}`; notice(linkNotice); },
});
function developmentUnavailable() {
  return Boolean(projectPresentation && (!projectPresentation.workingDevelopment()
    || !projectPresentation.developmentEnabled() || projectPresentation.busy() || !controlsConnected
    || snapshot?.installation?.status !== 'ready' || !snapshot?.workflow?.canSend));
}
function renderComposer() {
  projectPresentation?.nativePending(sending || Boolean(pending));
  const unavailable = developmentUnavailable();
  $('composer').hidden = Boolean(projectPresentation && !projectPresentation.workingDevelopment());
  $('send').disabled = unavailable || sending || clipboard.busy() || projectPresentation?.busy() || (projectPresentation && !projectPresentation.canSend()) || (projectPresentation?.discovery()
    ? !projectPresentation.canSend() : !snapshot?.workflow?.canSend);
  $('message').disabled = unavailable || sending || pendingSubmitted;
  if (projectPresentation) $('message').placeholder = projectPresentation.placeholder();
  annotation?.setSending(unavailable || sending || Boolean(pending));
  const presetsBlocked = unavailable || sending || Boolean(pending);
  $('quick-requests').hidden = projectPresentation?.discovery() === true;
  const summary = $('quick-requests').querySelector('summary');
  summary.setAttribute('aria-disabled', String(presetsBlocked));
  summary.tabIndex = presetsBlocked ? -1 : 0;
  for (const button of $('quick-requests').querySelectorAll('button')) button.disabled = presetsBlocked;
  if (presetsBlocked) $('quick-requests').open = false;
  $('send').textContent = pendingSubmitted && !sending ? 'Retry exact request' : '↑';
  $('send').dataset.retry = String(pendingSubmitted && !sending);
  $('send').setAttribute('aria-label', pendingSubmitted && !sending ? 'Retry exact request' : 'Send message');
  $('send').title = pendingSubmitted && !sending ? 'Retry exact request' : 'Send message';
  renderRoleHint();
}
function renderRoleHint() {
  const help = $('role-hint-help');
  const parsed = pending ? { roleHint: pending.roleHint, error: null } : parseRoleMention($('message').value);
  const text = parsed.error ?? (parsed.roleHint
    ? `Preference: @${parsed.roleHint.role} for this message. Router decides who responds.`
    : '');
  help.hidden = Boolean(projectPresentation?.discovery()) || !text;
  if (help.textContent !== text) help.textContent = text;
  if (help.hidden) $('message').removeAttribute('aria-describedby');
  else $('message').setAttribute('aria-describedby', help.id);
  $('message').setAttribute('aria-invalid', String(!help.hidden && Boolean(parsed.error)));
}
$('message').addEventListener('input', renderRoleHint);
function render() {
  clipboard.refresh();
  if (!snapshot) return;
  const view = snapshot.workflow;
  const installed = snapshot.installation;
  const compaction = view?.compaction;
  $('request-compaction').disabled = compactionRequesting || !compaction?.canRequest;
  $('request-compaction').textContent = compaction?.active ? 'Compacting model context...'
    : compaction?.requested ? 'Compaction requested...' : 'Compact model context...';
  $('compaction-status').hidden = !compaction?.active && !compaction?.requested && !compaction?.error;
  $('compaction-status').textContent = compaction?.active
    ? `Compacting model context. Workflow: ${humanLoopStatusLabel(view.status)}. Saved Conversation and Design remain retained.`
    : compaction?.requested ? 'Approved compaction requested. Waiting for the native runtime.'
      : compaction?.error ? `Context compaction failed: ${compaction.error}` : '';
  $('initialize').hidden = projectPresentation
    ? !projectPresentation.workingDevelopment() || !installed?.canReopen && !installed?.canRetry
    : !installed?.canStart && !installed?.canReopen && !installed?.canRetry;
  $('initialize').textContent = projectPresentation ? installed?.canReopen ? 'Reopen Development' : 'Retry Development'
    : installed?.canRetry ? 'Retry runtime' : installed?.canReopen ? 'Reopen runtime'
    : installed?.status === 'saved-state' ? 'Verify saved runtime' : 'Initialize runtime';
  $('inspect-initial-creation').hidden = !installed?.canInspectInitialRecovery;
  $('inspect-initial-creation').disabled = initialCreationInspecting;
  $('repair-empty-setup').hidden = !installed?.canInspectEmptyRepair;
  $('repair-empty-setup').disabled = emptySetupBusy;
  $('shutdown').disabled = !view || !['ready', 'unknown'].includes(installed?.status);
  renderComposer();
  $('connection-status').textContent = 'Live updates';
  renderStopControl();
  if (!$('notice').textContent || $('notice').textContent === installationNotice) notice(installed?.reason);
  installationNotice = installed?.reason ?? null;
  const handoffEntry = snapshot.messages.find((entry) => entry.id === view?.lastHandoff?.id);
  const questionGroups = view?.questionInteractions ?? [];
  const questionRequestId = questionGroups.find(group => group.questions.some(q => q.state === 'open' && q.blockingActive))?.source.requestId;
  const counts = view?.questionCounts ?? { unanswered: 0, blockers: 0, processing: 0 };
  $('show-questions').textContent = `Questions (${counts.unanswered}, ${counts.blockers} blockers)`;
  $('show-questions').title = counts.processing ? `${counts.processing} blocking answer request(s) still processing` : 'View saved questions and answers';
  $('show-questions').disabled = questionGroups.length === 0;
  const contextRequestId = view?.activeRequestId ?? handoffEntry?.requestId
    ?? (view?.currentCycle ? undefined : questionRequestId);
  const presentedView = view?.activeRequestId && handoffEntry?.requestId !== view.activeRequestId ? { ...view, lastHandoff: null } : view;
  const handoffText = handoffEntry?.text ?? handoffEntry?.content;
  const summaryInConversation = typeof handoffText === 'string' && Boolean(presentedView?.lastHandoff?.summary)
    && handoffText.includes(presentedView.lastHandoff.summary);
  renderHumanLoop($('human-workflow'), { view: presentedView, busy: false, questionsContainer: questionArtifact, questionWorkspace: true, cycleContainer: cycleArtifact,
    summaryInConversation, showQueue: false, answerDetails: snapshot.messages.flatMap(entry => (entry.answerDetails ?? [])
      .map(answer => ({ ...answer, answerRequestId: entry.requestId }))) }, {
    submitAnswers: async (batch) => {
      const key = JSON.stringify(batch);
      const sources = new Set(batch.answers.map(answer => answer.sourceResultId));
      if (!answerPending.has(key) && [...answerPending.values()].some(envelope =>
        envelope.answers.answers.some(answer => sources.has(answer.sourceResultId)))) {
        throw new Error('A previous answer for this source is unconfirmed. Refresh or retry that exact answer before changing it.');
      }
      const envelope = answerPending.get(key) ?? { id: crypto.randomUUID(), message: 'Question form submission.',
        receivedAt: new Date().toISOString(), answers: batch };
      answerPending.set(key, envelope);
      try { await post('/api/answers', envelope); answerPending.delete(key); await refresh(); }
      catch (error) {
        await refresh();
        if (error.accepted || snapshot?.messages.some(({ requestId }) => requestId === envelope.id)) { answerPending.delete(key); return; }
        if (error.notAccepted) answerPending.delete(key);
        throw error;
      }
    },
    stop: () => requestStopAfterStep(),
    refresh: () => refresh(), discuss: () => $('message').focus(),
    inspectReference: (binding, reference) => {
      const fromQuestion = !$('question-panel').hidden;
      inspectReference(binding, reference);
      if (fromQuestion) $('return-to-questions').hidden = false;
    },
    inspectQuestionSource: (resultId, requestId) => {
      const entry = snapshot.messages.find(entry => entry.resultId === resultId || entry.id === resultId || entry.id === `handoff:${resultId}`);
      if (entry) conversation.focusEntry(entry.id);
      else if (!queuedRequests.focusRequest(requestId)) conversation.focusRequest(requestId);
    },
  });
  $('private-history-status').hidden = snapshot.conversationStatus !== 'unverified';
  queuedRequests.render(snapshot.messages, view?.queue, !projectPresentation || projectPresentation.workingDevelopment());
  const entries = snapshot.messages.filter(entry => !entry.queuedStatus);
  const transitions = projectHumanHistory(snapshot.events, entries, snapshot.streamId, snapshot.historyRequests, snapshot.recoveries);
  conversation.render(entries, transitions);
  for (const entry of snapshot.messages.filter(entry => entry.queuedStatus)) {
    const button = $('state-history').querySelector(`[data-transition-id="${CSS.escape(entry.id)}"] > button`);
    if (button) {
      button.setAttribute('aria-controls', 'queued-requests');
      button.setAttribute('aria-label', 'Your request. View queued request or not-started history.');
    }
  }
  renderImplementationConfirmations();
  conversation.current({ kind: view?.status ?? 'host', label: compaction?.active ? `Compacting · ${humanLoopStatusLabel(view.status)}`
    : compaction?.requested ? 'Compaction requested'
      : view ? humanLoopStatusLabel(view.status) : projectPresentation && installed?.status === 'new'
        ? 'Development not activated' : installed ? humanLoopStatusLabel(installed.status) : 'Connecting',
    detail: view?.reason ?? installed?.reason ?? '' });
  if (view?.currentCycle) {
    conversation.placeArtifact('human-cycle-progress', cycleArtifact, { requestId: view.currentCycle.originRequestId,
      title: 'Implementation cycle progress', unlinked: !view.currentCycle.originRequestId });
  } else conversation.parkArtifact('human-cycle-progress', cycleArtifact, $('conversation-context-parking'));
  if (view && (view.activeRequestId || questionGroups.length || view.lastHandoff || view.lastStop?.invalidatedQuestions?.length || view.reason)) {
    conversation.placeArtifact('human-workflow', $('human-workflow'), { requestId: contextRequestId,
      entryId: handoffEntry && handoffEntry.requestId === contextRequestId ? handoffEntry.id : undefined,
      eventKind: 'human.handoff', title: 'Current workflow', unlinked: !contextRequestId });
  } else conversation.parkArtifact('human-workflow', $('human-workflow'), $('conversation-context-parking'));
  for (const entry of entries) {
    const row = [...$('messages').children].find((row) => row.dataset.entryId === entry.id);
    if (row) {
      row.dataset.role = entry.role ?? entry.kind;
      const label = row.querySelector('.conversation-role');
      if (label) label.textContent = entry.id.startsWith('discovery:') ? entry.role : entry.kind === 'user'
        ? entry.queueState === 'retired' ? 'Not resumed after Recovery' : entry.queueState ?? '' : entry.role ?? '';
      if (label && entry.kind === 'user' && entry.roleHint) {
        label.textContent += `; Preference: @${entry.roleHint.role}`;
        label.title = 'Per-message preference only. Router decides who responds.';
      }
      if (entry.kind === 'user') row.querySelector('time').title = `Received ${new Date(entry.timestamp).toLocaleString()}`;
    }
  }
  renderPermissions();
  renderBackground();
  $('apps').replaceChildren(...(snapshot.processes?.apps ?? []).map((app) => {
    const row = make('div'), label = make('span', `${app.command}: ${app.status} `); row.append(label);
    if (app.url?.startsWith('http://127.0.0.1:')) { const link = make('a', app.url); link.href = app.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(link); }
    if (app.canStop) { const stop = make('button', 'Stop preview'); stop.onclick = () => post('/api/apps/stop', { id: app.id }).then(refresh).catch((error) => notice(error.message)); row.append(stop); }
    return row;
  }));
  const designVerified = snapshot.conversationStatus !== 'unverified' && ['ready', 'closed'].includes(installed?.status);
  const statusOwner = projectPresentation?.handoffStatusOwner();
  const prototypeActivity = designVerified ? currentHandoffActivity(snapshot.workflow?.handoffActivity, statusOwner) : null;
  const showPrototypeActivity = prototypeActivity && prototypeActivity.requestId !== statusOwner
    && !quietHandoff(prototypeActivity, snapshot.design?.content ? snapshot.design.binding : null, snapshot.accessRequests?.length ?? 0);
  $('prototype-handoff-activity').hidden = !showPrototypeActivity;
  $('prototype-handoff-activity').textContent = showPrototypeActivity ? prototypeActivity.label : '';
  if (designVerified) lastVerifiedDesign = snapshot.design;
  const displayedDesign = designVerified ? snapshot.design : lastVerifiedDesign;
  const hasDesign = Boolean(displayedDesign?.content);
  document.body.dataset.designContent = hasDesign ? 'available' : 'empty';
  $('backbone-proposal').hidden = !hasDesign;
  $('assessment-card').hidden = hasDesign;
  $('backbone-state').textContent = !designVerified ? 'Design unverified' : hasDesign ? 'Current Design' : 'No Design yet';
  $('assessment-card').querySelector('strong').textContent = designVerified ? 'No Design has been published' : 'Design is not yet verified';
  $('assessment-card').querySelector('p').textContent = designVerified
    ? prototypeActivity ? 'The saved Prototype request is tracked in Conversation. Design will appear here when published.'
      : 'Discuss your idea in the conversation. The current Design will appear here when it is ready.'
    : 'Restore the Development connection to verify saved Design. Unavailable does not mean empty.';
  if (hasDesign) {
    const raw = JSON.stringify(displayedDesign.content, null, 2);
    if ($('design-raw').textContent !== raw) $('design-raw').textContent = raw;
  }
  designView.render(displayedDesign);
  if (designVerified && !hasDesign) { designDigest = null; $('project-name').textContent = 'Your project'; $('design-summary').textContent = ''; }
  const key = hasDesign ? `${displayedDesign.binding.revisionId}:${displayedDesign.binding.digest}` : null;
  if (hasDesign && key !== designDigest) {
    designDigest = key;
    const value = displayedDesign.content, binding = { ...displayedDesign.binding };
    $('design-summary').textContent = value.summary;
    $('project-name').textContent = value.goal ?? 'Your project';
    $('project-name').title = value.goal ?? '';
    $('design-goal').textContent = value.goal;
    $('design-outcomes').replaceChildren(...value.outcomes.map((outcome) => {
      const row = make('li'); row.append(make('p', outcome.description));
      for (const reference of outcome.references) {
        const button = make('button', reference); button.type = 'button'; button.className = 'design-reference';
        button.addEventListener('click', () => inspectReference(binding, reference)); row.append(button);
      }
      return row;
    }));
  }
  conversation.refreshLayout();
  projectPresentation?.publish(snapshot);
  focusProjectOutput();
  const outputView = $('project-output-view');
  if (!outputView.hidden && selectedOutput) {
    let warning = outputView.querySelector('[data-output-warning]');
    const current = projectOutputs(snapshot).items.some(item => item.id === selectedOutput.id && item.binding === selectedOutput.binding);
    if (!current && !warning) {
      warning = make('p', 'This displayed binding is no longer the current verified output. Select an available output from Artifacts to refresh it.');
      warning.dataset.outputWarning = ''; warning.setAttribute('role', 'alert'); outputView.prepend(warning);
    } else if (current) warning?.remove();
  }
}
function renderBackground() {
  renderBackgroundProcesses($('background-processes'), snapshot?.processes?.nativeSessions ?? [], {
    connected: controlsConnected,
    stop: async id => {
      await post('/api/apps/stop', { id });
      if (!await refresh()) throw new Error('Could not refresh the native process state. Refresh status before retrying.');
    },
    onError: error => notice(error.message),
  });
}
let permissionSignature = '';
function renderPermissions() {
  const remembered = snapshot.rememberedApprovals;
  $('access-approval').hidden = !snapshot.accessRequests.length;
  $('remembered-approvals').hidden = !remembered;
  renderPermissionRequests($('access-requests'), snapshot.accessRequests, {
    decide: async (id, decision) => { await post(`/api/access/${encodeURIComponent(id)}`, { decision }); await refresh(); },
    approvePendingOnce: async requestIds => {
      const result = await post('/api/permissions/once', { requestIds });
      const unavailable = result.results.filter(entry => entry.status === 'not-pending').length;
      if (unavailable) notice(`${result.results.length - unavailable} permissions approved; ${unavailable} were no longer pending. Later arrivals were not included.`);
      if (!await refresh()) throw new Error('Could not refresh permissions. The captured approval result was saved; refresh before retrying.');
    },
    onError: error => notice(error.message),
  });
  const signature = JSON.stringify([snapshot.accessRequests, remembered, snapshot.workflow?.canResetApprovals]);
  if (signature === permissionSignature) return;
  permissionSignature = signature;
  $('remembered-approvals').replaceChildren();
  if (remembered) {
    const card = make('article'); card.className = 'access-card';
    const controls = make('div'); controls.className = 'settings-access-controls';
    const status = make('strong', `Session access: ${remembered.all ? 'On' : 'Off'}`);
    status.setAttribute('role', 'status');
    controls.append(status);
    card.append(make('h3', 'Session access'), controls);
    if (remembered.all) {
      const off = make('button', 'Turn off session access');
      off.type = 'button'; off.dataset.sessionAccessOff = '';
      off.onclick = async () => {
        off.disabled = true;
        try { await post('/api/permissions/off', {}); await refresh(); }
        catch (error) { off.disabled = false; notice(error.message); }
      };
      controls.append(off);
      card.append(make('p', 'Current and future eligible native and custom access is approved for this private Tandem session. Managed-required requests still prompt.'),
        make('p', 'Turning off revokes session-wide access for future callbacks without denying pending requests or cancelling already authorized commands. Native permission mode stays manual.'));
    } else {
      card.append(make('p', 'Session-wide automatic access is off. To enable it, use "Allow current + future access for this Tandem session" on an eligible pending permission request. Native permission mode stays manual.'));
    }
    if (remembered.tools.length) {
    card.append(make('p', `Separate custom per-tool approvals: ${remembered.tools.join(', ')}. These are not session-wide grants.`),
      make('p', 'Reset custom approvals requires an idle private runtime. Unanswered questions and unfinished plans stay intact. It does not reset native CLI grants or cancel already authorized commands.'));
    const reset = make('button', 'Reset custom approvals');
    reset.type = 'button'; reset.dataset.resetApprovals = '';
    reset.disabled = !snapshot.workflow?.canResetApprovals;
    reset.onclick = async () => {
      reset.disabled = true;
      try { await post('/api/permissions/reset', {}); await refresh(); }
      catch (error) { reset.disabled = !snapshot.workflow?.canResetApprovals; notice(error.message); }
    };
    card.append(reset);
    }
    $('remembered-approvals').append(card);
  }
}
async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const response = await fetch('/api/snapshot'); const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    snapshot = value;
    controlsConnected = true;
    if (!settingsLoaded) void refreshSettings();
    if (pending && snapshot.messages.some(({ requestId }) => requestId === pending.id)) completePending();
    render(); return true;
  })().catch((error) => { controlsConnected = false; projectPresentation?.unavailable(error.message);
    renderComposer(); renderBackground(); renderStopControl(); renderImplementationConfirmations(); notice(error.message); return false; }).finally(() => { refreshing = null; });
  return refreshing;
}
function completePending() {
  if (pending && $('message').value === pending.message) $('message').value = '';
  if (pendingPreviewUrl && annotation.preview()?.url === pendingPreviewUrl) annotation.removePreview();
  const clearClipboard = pendingClipboardId && clipboard.current()?.attachment.id === pendingClipboardId;
  pending = null; pendingSubmitted = false; pendingPreviewUrl = null; pendingClipboardId = null;
  if (clearClipboard) clipboard.clear();
}
const clipboard = installComposerImage({
  input: $('message'), preview: $('clipboard-preview'), image: $('clipboard-image'),
  caption: $('clipboard-caption'), remove: $('clipboard-remove'),
  blocked: () => developmentUnavailable() || sending || pendingSubmitted, hasAnnotation: () => Boolean(annotation.preview()),
  onChange: () => { if (snapshot) render(); }, onError: notice,
  upload: async blob => {
    const response = await fetch('/api/image-attachments', { method: 'POST', headers: { 'content-type': blob.type }, body: blob });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? 'Image could not be stored.');
    return value.attachment;
  },
});
installComposerEnter($('message'), $('composer'), () => !sending && !$('send').disabled);
$('quick-requests').querySelector('summary').addEventListener('click', event => {
  if (sending || pending) event.preventDefault();
});
$('quick-requests').addEventListener('click', event => {
  const button = event.target.closest('[data-quick-request]');
  if (!button || button.disabled || sending || pending) return;
  const input = $('message'), hadDraft = input.value.length > 0;
  input.value += `${hadDraft ? '\n\n' : ''}${button.value}`;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  $('quick-requests').open = false;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  notice(hadDraft ? 'Request added after your existing draft. Review and edit before sending.'
    : 'Request added to your draft. Edit it, then Send.');
});
$('quick-requests').addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !$('quick-requests').open) return;
  event.preventDefault(); event.stopPropagation();
  $('quick-requests').open = false;
  $('quick-requests').querySelector('summary').focus();
});
document.addEventListener('pointerdown', event => {
  if (!$('quick-requests').contains(event.target)) $('quick-requests').open = false;
});
$('quick-requests').addEventListener('focusout', event => {
  if (event.relatedTarget && !$('quick-requests').contains(event.relatedTarget)) $('quick-requests').open = false;
});
$('composer').addEventListener('submit', async (event) => {
  event.preventDefault(); if (developmentUnavailable() || projectPresentation && !projectPresentation.canSend()
    || sending || clipboard.busy() || (!$('message').value.trim() && !clipboard.current() && !annotation.preview())) return;
  if (projectPresentation?.discovery()) {
    if (pending || clipboard.current() || annotation.preview()) { notice('Resolve the Development request or remove its attachment before sending to discovery.'); return; }
    const text = $('message').value;
    sending = true; renderComposer();
    try {
      await projectPresentation.submit(text);
      if ($('message').value === text) $('message').value = '';
      notice('Discovery action received.');
    } catch (error) { notice(error.message); }
    finally { sending = false; renderComposer(); }
    return;
  }
  sending = true; annotation.setSending(true); notice(''); renderComposer();
  try {
    if (pending && pending.message !== $('message').value) throw new Error('The previous request is unconfirmed. Refresh before replacing its text.');
    if (!pending) {
      const { roleHint, error } = parseRoleMention($('message').value);
      if (error) throw new Error(error);
      pending = { id: crypto.randomUUID(), message: $('message').value, receivedAt: new Date().toISOString(),
        ...(roleHint ? { roleHint } : {}) };
      const preview = annotation.preview();
      if (preview && clipboard.current()) throw new Error('Remove either the pasted image or diagram snapshot before sending. One image is supported per request.');
      pendingPreviewUrl = preview?.url ?? null;
      if (preview) {
        const response = await fetch('/api/annotation-attachments', { method: 'POST',
          headers: { 'content-type': 'image/png', 'x-annotation-source': encodeURIComponent(JSON.stringify(preview.source)) }, body: preview.blob });
        const value = await response.json(); if (!response.ok) throw new Error(value.error);
        pending.attachments = [value.attachment];
      } else if (clipboard.current()) {
        pendingClipboardId = clipboard.current().attachment.id;
        pending.attachments = [clipboard.current().attachment];
      }
    }
    const envelope = pending;
    pendingSubmitted = true;
    const acknowledgement = await post('/api/requests', envelope, 202);
    if (acknowledgement.requestId !== envelope.id) throw new Error('Request acknowledgement has another identity; refresh before retrying.');
    if (pending?.id === envelope.id) completePending();
    notice('Request received.');
  } catch (error) {
    if (error.accepted || (pending && snapshot?.messages.some(({ requestId }) => requestId === pending.id))) completePending();
    else {
      if (error.notAccepted || !pendingSubmitted) { pending = null; pendingSubmitted = false; pendingPreviewUrl = null; pendingClipboardId = null; }
      notice(error.message);
    }
  } finally {
    sending = false; annotation.setSending(pendingSubmitted); renderComposer();
    void refresh();
  }
});
$('refresh').onclick = () => refresh();
$('open-rendering-debugger').onclick = () => {
  $('canvas-settings').open = false;
  const frame = $('rendering-debugger-frame');
  if (!frame.hasAttribute('src')) frame.src = 'sketch/example.html';
  $('rendering-debugger').showModal();
  $('close-rendering-debugger').focus();
};
$('close-rendering-debugger').onclick = () => $('rendering-debugger').close();
$('rendering-debugger').addEventListener('close', () => {
  $('canvas-settings').open = true;
  $('open-rendering-debugger').focus();
});
$('rendering-debugger-frame').addEventListener('load', () => {
  const frame = $('rendering-debugger-frame');
  if (!frame.hasAttribute('src')) return;
  const error = $('rendering-debugger-error');
  const loaded = !!frame.contentDocument?.querySelector('[data-sketch-debugger]');
  error.hidden = loaded;
  error.textContent = loaded ? '' : 'Rendering debugger could not load. Close it and check the renderer package.';
});
$('open-diagnostics').onclick = () => {
  const panel = $('advanced-workflow-controls'); panel.open = !panel.open;
  $('canvas-settings').open = false;
  (panel.open ? panel : $('canvas-settings')).querySelector('summary').focus();
};
$('advanced-workflow-controls').addEventListener('toggle', () => {
  const panel = $('advanced-workflow-controls');
  $('open-diagnostics').setAttribute('aria-expanded', String(panel.open));
  if (!panel.open && panel.contains(document.activeElement)) $('canvas-settings').querySelector('summary').focus();
});
$('advanced-workflow-controls').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault(); $('advanced-workflow-controls').open = false;
    $('canvas-settings').querySelector('summary').focus();
  }
});
function revealCurrentQuestion() {
  const target = questionArtifact.querySelector('fieldset[data-question-state="open"] select:not([disabled])');
  if (!target) return false;
  showQuestions();
  return true;
}
$('show-questions').onclick = () => {
  if ($('question-panel').hidden) showQuestions();
  else closeQuestions({ focus: true });
};
$('questions-back').onclick = () => closeQuestions({ focus: true });
$('return-to-questions').onclick = showQuestions;
$('questions-conversation').onclick = () => $('message').focus();
$('question-panel').addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  event.preventDefault(); closeQuestions();
  $('show-questions').focus();
});
$('focus-current-message').onclick = () => {
  if (!revealCurrentQuestion()) {
    const requestId = snapshot?.workflow?.activeRequestId
      ?? snapshot?.workflow?.questionInteractions?.[0]?.source.requestId ?? snapshot?.messages.at(-1)?.requestId;
    if (!queuedRequests.focusRequest(requestId)) conversation.focusRequest(requestId);
  }
};
function requestStopAfterStep() { return requestWorkflowStop('after-step'); }
function requestWorkflowStop(mode) {
  if (stopRequest) return stopRequest;
  const view = snapshot?.workflow;
  if (!controlsConnected || !(mode === 'immediate' ? view?.canStopNow : view?.canStop)) return Promise.resolve();
  const scope = JSON.stringify([view?.activeRequestId, view?.currentCycle?.id,
    view?.questionInteractions?.filter(group => group.questions.some(q => q.blockingActive)).map(group => group.resultId)]);
  if (!stopAttempt || stopAttempt.scope !== scope) stopAttempt = { scope, stopId: crypto.randomUUID() };
  const stopId = view?.stop?.id ?? stopAttempt.stopId;
  notice('');
  stopRequest = (async () => {
    try { await post('/api/stop', mode === 'immediate' ? { stopId, mode } : { stopId }); }
    catch (error) {
      await refresh();
      const view = snapshot?.workflow;
      const accepted = view?.stop?.id === stopId && (mode !== 'immediate' || view.stop.mode === 'immediate');
      if (!accepted && view?.lastStop?.id !== stopId) throw error;
    }
    stopAttempt = null;
    await refresh();
  })().finally(() => { stopRequest = null; render(); });
  render();
  return stopRequest;
}
$('initialize').onclick = () => projectPresentation ? projectPresentation.activate(snapshot.installation?.canRetry) : post('/api/runtime/start', snapshot.installation?.canRetry ? { retry: true } : {})
  .then(async () => { notice(''); await refresh(); }).catch((error) => notice(error.message));
$('inspect-initial-creation').onclick = async () => {
  if (initialCreationInspecting) return;
  initialCreationInspecting = true; render();
  let failure = null;
  try {
    const result = await post('/api/runtime/initial-creation/inspect', {});
    initialCreationConfirmation = result.confirmationId;
    $('initial-creation-detail').textContent = result.message;
    $('initial-creation-identity').textContent = `Workspace: ${result.workspacePath}\nMain session: ${result.mainSessionId}\nReserved private session: ${result.privateSessionId}\n\n${result.reason ?? ''}`;
    $('initial-creation-approval').showModal();
  } catch (error) { failure = error; }
  finally { initialCreationInspecting = false; render(); if (failure) notice(failure.message); }
};
$('repair-empty-setup').onclick = async () => {
  if (emptySetupBusy) return;
  emptySetupBusy = true; render();
  try {
    const result = await post('/api/runtime/empty-setup/inspect', {});
    emptySetupConfirmation = result.confirmationId;
    $('empty-setup-detail').textContent = result.message;
    $('empty-setup-identity').textContent = `Project: ${result.workspacePath}\nMain session: ${result.mainSessionId}\nSame private session: ${result.privateSessionId}\n\n${JSON.stringify(result.binding, null, 2)}`;
    $('empty-setup-approval').showModal();
  } catch (error) { notice(error.message); }
  finally { emptySetupBusy = false; render(); }
};
$('cancel-empty-setup').onclick = () => $('empty-setup-approval').close();
$('empty-setup-approval').addEventListener('close', () => {
  const confirmationId = emptySetupConfirmation; emptySetupConfirmation = null;
  $('repair-empty-setup').focus({ preventScroll: true });
  if (confirmationId) void post('/api/runtime/empty-setup/decision', { confirmationId, approve: false })
    .catch(error => notice(error.message));
});
$('approve-empty-setup').onclick = async () => {
  if (emptySetupBusy || !emptySetupConfirmation) return;
  const confirmationId = emptySetupConfirmation;
  emptySetupConfirmation = null; $('empty-setup-approval').close();
  emptySetupBusy = true; render();
  try {
    const result = await post('/api/runtime/empty-setup/decision', { confirmationId, approve: true });
    await refresh();
    if (result.readback?.verified === false) {
      $('canvas-settings').open = true; $('setting-model').focus(); void refreshSettings();
      notice(`The same session was reinitialized, but model verification is still required. Select and apply a private model in Settings. The handoff remains unsent. ${result.readback.reason ?? ''}`);
    } else notice('Development setup repaired with the same reserved ID. The retained handoff has not been submitted.');
  } catch (error) { notice(error.message); }
  finally { emptySetupBusy = false; render(); }
};
$('cancel-initial-creation').onclick = () => $('initial-creation-approval').close();
$('initial-creation-approval').addEventListener('close', () => {
  const confirmationId = initialCreationConfirmation; initialCreationConfirmation = null;
  $('inspect-initial-creation').focus({ preventScroll: true });
  if (confirmationId) void post('/api/runtime/initial-creation/decision', { confirmationId, approve: false })
    .catch(error => notice(error.message));
});
$('approve-initial-creation').onclick = async () => {
  const confirmationId = initialCreationConfirmation;
  if (!confirmationId) return;
  initialCreationConfirmation = null; $('initial-creation-approval').close();
  try { await post('/api/runtime/initial-creation/decision', { confirmationId, approve: true }); notice(''); await refresh(); }
  catch (error) { await refresh(); notice(error.message); }
};
$('shutdown').onclick = () => post('/api/runtime/close', {}).then(refresh).catch((error) => notice(error.message));
$('open-project-folder').onclick = async () => {
  $('open-project-folder').disabled = true;
  const status = $('project-folder-status');
  status.hidden = false; status.textContent = 'Requesting the project folder in Explorer...';
  try {
    const result = await post('/api/project/open-folder', {});
    if (result.requested !== true || typeof result.path !== 'string') throw new Error('Explorer launch was not confirmed.');
    status.textContent = `Explorer requested for ${result.path}`;
  } catch (error) { status.textContent = `Project folder was not opened: ${error.message}`; }
  finally { $('open-project-folder').disabled = false; }
};
$('request-compaction').onclick = async () => {
  compactionRequesting = true; render();
  try {
    const value = await post('/api/context/compaction/request', {});
    compactionRequest = value.requestId;
    $('compaction-approval').showModal();
  } catch (error) { notice(error.message); }
  finally { compactionRequesting = false; render(); }
};
$('cancel-compaction').onclick = () => $('compaction-approval').close();
$('compaction-approval').addEventListener('close', () => {
  const requestId = compactionRequest; compactionRequest = null;
  $('request-compaction').focus({ preventScroll: true });
  if (requestId) void post('/api/context/compaction/decision', { requestId, approve: false })
    .catch((error) => notice(error.message));
});
$('approve-compaction').onclick = async () => {
  const requestId = compactionRequest;
  if (!requestId) return;
  compactionRequest = null; $('compaction-approval').close();
  $('canvas-settings').open = false;
  $('message').focus({ preventScroll: true });
  try { await post('/api/context/compaction/decision', { requestId, approve: true }); await refresh(); }
  catch (error) { notice(error.message); }
};
const stream = new EventSource('/api/events');
const implementationConfirmations = createImplementationConfirmations({
  document, conversation, parking: $('conversation-context-parking'),
  decide: async (id, decision) => {
    try { await post(`/api/implementation-confirmations/${encodeURIComponent(id)}`, { decision }); }
    finally { await refresh(); }
  },
});
function renderImplementationConfirmations() {
  implementationConfirmations.render(snapshot?.workflow?.implementationConfirmations, { connected: controlsConnected });
}
stream.addEventListener('update', () => void refresh());
stream.onerror = () => { controlsConnected = false; renderBackground(); renderStopControl(); renderImplementationConfirmations(); $('connection-status').textContent = 'Reconnecting'; };
setInterval(() => void refresh(), 3000);
await refresh();
