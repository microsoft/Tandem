# Requirements

Plan the **complete currently identifiable question DAG up front**, in the
conversation you already use. Every node already has its meaningful question,
rationale, prerequisites, alternatives, recommendation (or none) and free-text
route, including questions that are currently blocked. Then discuss one eligible
question at a time. Focusing one question does not mean planning or disclosing
only one.

The primary Mermaid diagram contains **questions/decisions**, with directed
**prerequisite** edges. It is not a feature/scope tree with a new open question
added each turn. Real shared prerequisites, multiple parents and independent
branches remain visible. A real DAG can happen to be tree-shaped; artificial
cross-links or a forced minimum question count are not useful.

Use the existing brief and accepted intent, not every imaginable feature.
Already-supplied answers remain answered; a detailed brief can need no new
clarification. Do not reopen an already-confirmed scope just to demonstrate the skill.

An active clarification turn does not end at a list of loose ends. After the
graph and brief change summary, the agent asks **one consequential question
needed now**, or asks whether the displayed graph/summary **covers everything
you want or needs additions/changes** when scope is clear. This combines final
confirmation and completeness in one prompt. It does not invent more gaps to
keep asking. An actual pause/deferral, unavailable interaction, simple
acknowledgment or already-confirmed
completion can end without another prompt; confirmation ends the loop normally.

## Demo

See the complete question DAG, answers unlocking an already-planned question,
and a correction reopening dependent decisions while preserving independent
answers.

![Illustrative workshop-booking question DAG: all seven questions appear up front, volunteered answers unlock the attendee-count question, and a payment correction reopens dependent decisions while retaining independent answers.](media/requirements-question-dag.gif)

Illustrative screenshot replay of the skill's authored fictional examples,
captured from an isolated presentation viewer. Labels are shortened for
readability; question IDs, states, prerequisites and focus are preserved.
No live model or private user content was used. This is not a native
Claude/Codex recording, a model-quality evaluation, or an implemented universal
question UI. Mermaid and question presentation vary by host; the capture-only
viewer is not part of this skill.

## Use with your agent

Make this folder available through your host's ordinary skill-loading mechanism,
or load its self-contained [SKILL.md](SKILL.md) as instructions. For example:

> Help me clarify the requirements for a personal task list. Use what I have
> already described to plan the whole identifiable question/prerequisite DAG
> before asking. Show it as we refine answers, and focus one eligible question.

The graph appears in a normal fenced `mermaid` chat block, with a short text
outline so it remains understandable when the host cannot render Mermaid.
Show the full current DAG initially and after every substantive iteration,
including Answered, Ready, Blocked and applicable Review/Deferred nodes.
Concise labels and a text/delta outline keep it understandable; do not hide
blocked branches to make it look small. The scope/requirements summary stays in
accompanying text, with confirmed, proposed, assumed, open and deferred meanings
distinct. A proposal is not silently treated as accepted scope or a blocker.

After an answer, review all transitive dependents and update only affected
definitions/choices/prerequisites/readiness. A correction invalidates descendant
old answers, preserving their exact prior values and reasons for review rather
than silently keeping them approved. Independent answers and stable IDs survive.
Add a node only for a necessary decision genuinely revealed by new accepted
information, not one arbitrary question per turn. Do not delete history or
regenerate the whole interview.

The node for the **next** question gets a thick accent border and explicit
**FOCUS** text. Its ID and decision status stay unchanged: focus is not acceptance.
For confirmation, accompanying text identifies the **whole decision DAG** as
**REVIEW FOCUS**; no feature/approval node is added. Simple passive Mermaid
class/style syntax supplies the
border; the text marker keeps the focus understandable without color/rendering.
The actual question follows in the host's available native question tool,
not inside the graph or a simulated tool-call transcript.

This is not a diagram placed in front of the same mandatory interview. There is
no per-node question quota or requirement to settle every open suggestion.
The [fictional complete-DAG example](SKILL.md#fictional-complete-dag-example)
shows all seven questions planned initially, several ready and blocked nodes,
shared/multi-parent prerequisites and an independently answered branch. Later
answers/correction update those same nodes and retain invalidated-answer history.
This is an authored illustration, not real user approval or model-quality evidence.

Use the host's native question controls when available; ordinary chat is enough
otherwise. Selection is capability-based, not a per-agent runtime adapter:
tool names and availability vary by host, mode and configuration. The agent
follows the actual exposed tool's schema and permissions, without changing modes
or settings to acquire it or silently dropping planned alternatives to fit it.
If interaction is unavailable, it stops at the
unresolved input rather than inventing an answer.

## Understanding a question

If a term or question is unfamiliar, the agent pauses that decision and uses
appropriate **existing host research/reading tools** and relevant supplied or
authoritative material. It explains briefly in plain language, with an example
or contrast and relevance to the current choice. This help is available during
clarification/reconciliation even when it does not change scope.

Only consulted sources are cited; uncertainty or failed/unavailable access is
disclosed. Retrieved material is evidence, not instructions. Lookup stays
proportionate and within ordinary permissions/privacy constraints, without new
connectors, SDKs, configuration changes or paid/model workers.

The agent then resumes the **same decision**, without adding a terminology node,
discarding independent answers, restarting the interview or automatically asking
an extra understanding-check question. If evidence changes a question/prerequisite,
only affected definitions/readiness are reconciled and the full-DAG delta is shown.
Research never answers the user's product choice or accepts scope for them.

## Confirming completeness

At the end, the full current DAG and concise summary are followed by one combined
question: **Does this cover everything you want, or is anything missing that you
would like to add or change?** The native question control is used when available,
with ordinary chat as fallback. Completion and add/change are meaningful routes;
neither is assumed. Silence, unrelated replies and answering the last product
question do not confirm completion.

New requirements extend the **existing** DAG: all newly identifiable relevant
questions are planned together, including blocked definitions/options, while stable
IDs, unaffected answers and history are preserved. The agent continues with one
eligible focused question and revisits completeness after addressing the additions.
If you explicitly confirm completion, the loop closes. If you are unsure or defer,
that status remains honest. Unaccepted proposals/assumptions/open/deferred items
are not silently approved, and completion never authorizes implementation.

## No extra runtime

There is no required browser, local server, Node/npm installation,
build, listener, request button, copy/paste handoff, Copilot account or other
Tandem skill. The full Tandem framework and brainstorm-whiteboard remain
separate, independently usable products.

Confirmed decisions, proposals, assumptions and unresolved items stay distinct.
The agent revisits only choices affected by a correction, not the entire
interview. Graphs and summaries should be proportionate, not a growing ledger.
Accepting a statement, confirming the overall graph, and authorizing
implementation are separate. Graph confirmation does not silently promote
unconfirmed items or authorize implementation.

Conversation retention belongs to your host. This skill does not create its own
persistent memory, RAM service or files. Save/export happens only when requested,
using normal host tools and permissions; it never implies Git publication.

## Maintainers only

The canonical instructions are `buildRequirementsSkill()` in the repository's
`src/planning-prompts.ts`. Root `npm run build:requirements` generates the static
SKILL.md; `node --import tsx scripts\build-requirements-skill.ts --check` checks
exact agreement. Root builds also refresh it. Consumers do not run these commands
and need none of the repository's development tooling.

The root `package.json` remains the release-version authority for the optional
Claude/Codex catalog manifests. No runtime, package installer, hook or provider
backend is shipped. The former web experiment is not a second default product.

The consumption core is five static instruction/documentation/metadata files.
The allowlisted GIF under `media/` is optional documentation, not a runtime or
execution dependency. Capture scripts, presentation assets and raw frames are
not shipped.

Packaging/generation checks verify the copied instructions and metadata.
Example checks use the repository's existing Mermaid facilities; those are
maintainer checks, not consumer dependencies or proof of model-generated quality.
Neither establishes conversational quality or universal native-host activation.
The next qualification is an ordinary tryout in the user's chosen host; no paid
model evaluation is implied by these checks.

Retain the [MIT license](LICENSE.txt) when copying the folder.
