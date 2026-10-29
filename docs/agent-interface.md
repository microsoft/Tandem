# Deterministic application interface

Tandem exposes one versioned application contract for agents and the UI.
The contract is independent of DOM selectors, browser automation, canvas panel
identities and model prompts. It does not create another workflow engine.

## Design and migration

The application exposes **inspect** and **execute**. Inspection returns saved
state, operation descriptions, input schemas on request, and current blockers.
Execution uses a named operation and structured input, with explicit project or
review targeting. The same application handlers serve the existing UI routes.
An operation catalog is not authorization: input-specific checks and the owning
runtime revalidate every mutation.

This is preferable to a general-purpose HTTP or JavaScript execution tool: agents
cannot choose an arbitrary endpoint, inject code, replace application state, or
invent workflow transitions. It is also preferable to a second agent scheduler:
the existing workflow receipts, transactions and native Development runtime
remain authoritative.

Migration order:

1. Define the shared versioned protocol, operation metadata and validation.
2. Separate upstream and review application dispatch from HTTP transport.
3. Expose all task operations, including review drafts, through inspection and
   execution. Preserve existing UI semantics and saved records.
4. Bridge native Development through its own projected state and application
   handlers. Do not copy its scheduling, prompts, permissions or completion rules.
5. Replace the old canvas action catalog with thin adapters and expose ordinary
   SDK tools that do not require a canvas to be open.
6. Exercise the same handlers through HTTP and agent adapters, including stale
   requests, invalid inputs, wrong targets and human-only decisions.

No compatibility guarantee is made for the former canvas action names. The
application UI, saved state and Development ownership are not reset or replaced.

## Authority and results

An agent can inspect work, submit explicit task requests, prepare drafts and
operate within an already authorized task. It cannot supply human approval,
answer a user's unresolved product decision, grant native permissions, approve
implementation, or manufacture completion evidence. These operations remain
visible in discovery as human-required actions so an agent can report the exact
blocker rather than guess or work around it.

Admission is not completion. An accepted command can launch asynchronous work;
agents read its saved request and processing identities until the owning runtime
records a result. Retry policy is declared per operation: reads are repeatable,
identity-bound requests retain their exact identities, and other mutations
require fresh inspection after an uncertain result. There is no generic replay
manager or automatic retry.

Upstream state changes bind the observed effort generation and revision. Draft
operations also retain their parent linkage and baseline checks. Native
Development continues to use its original request, question, Design,
implementation-confirmation and permission identities. Project state is not a
substitute for those native identities.

Pure presentation actions such as selecting a tab, scrolling or opening a dialog
are not task operations. Unsaved editor text and rendering readiness remain
local UI concerns; saved-state eligibility and mutation enforcement belong to
the application.

## Calling the interface

The provider contributes two ordinary SDK tools, named
`tandem_inspect_<scope>` and `tandem_execute_<scope>` (`project`, `user` or
`session`). They work without opening a canvas. The small `get_application` and
`execute_application` canvas adapters call the same implementation. The
`get_integration` and `close_development` actions remain host lifecycle controls;
they are not an alternative task API.

```js
const view = await tandem_inspect_project({
  target: { prototypeId: "task-board" }
});

// Inspect one operation for its full input schema and current availability.
await tandem_inspect_project({
  target: view.target,
  operation: "reviews.open"
});

await tandem_execute_project({
  protocol: "tandem-application/v1",
  target: view.target,
  expected: view.binding,
  operation: "reviews.open",
  input: {
    stageId: "requirements",
    expectedGeneration: view.binding.generation
  }
});
```

The example assumes Requirements is an available earlier stage. The returned
draft supplies its own `prototypeId`; use it as `target.reviewId` while retaining
the parent `target.prototypeId`. Reinspect that target for its draft binding
before editing. Reading a draft, editing it, and applying it are distinct
operations. Agents can prepare drafts; applying them remains human-required.

For native work, inspect with `owner: "development"` and use `native.*`
operations. `native.submit` takes the native `id`, exact `message` and
`receivedAt`, plus supported attachments or an explicit role hint. Retain the
same envelope if admission is uncertain. Do not send an upstream `expected`
binding to a native operation; it is rejected rather than ignored.
`native.state` exposes projected Design,
internal plans, tasks, results and questions; it does not expose a plan-approval
shortcut or private reasoning.

`requirements.submit` with `action: "generate-dag"` needs no invented question
ID or placeholder answer: it operates on the saved accepted usages.
Request-producing operations return their request identity when it is available.
Image attachment commands return exact stored references for `native.submit`;
retained image reads use base64 over HTTP and image results in SDK tools.

The standalone Node host serves the same agent contract at
`POST /api/application/inspect` and `POST /api/application/execute` on the
application's loopback URL. The native provider also serves those endpoints for
its own operations. Their caller authority is fixed to agent; an `actor` field
is rejected. Existing human UI routes remain thin transport adapters to the
same application dispatch and preserve their existing response/error semantics.
Neither API accepts arbitrary URLs, method names or executable code.

## Contract details

Inspection returns the protocol, owner, saved state and operation catalog.
Upstream inspection additionally returns the exact target and its
`binding: { generation, revision }`. Operation entries contain description,
effect, authority, input-dependent `humanActions`, retry policy and availability.
Full input schemas are included only when inspecting a specific operation,
avoiding a large all-schema prompt on every state read. Supplying `input` to
inspection evaluates input-dependent human-decision requirements; execution
always validates the schema and the actual owning handler.

Availability reports `available`, `blocked` or `human-required` with stable
blocker codes and messages. It describes current saved-state eligibility, not a
promise that every input is valid or that state cannot change. Domain-specific
prerequisites, exact source identities, model capabilities and permission checks
remain authoritative at execution.

Execution returns `protocol`, `operation`, `outcome` (`read` or `accepted`) and
`data`. Failures remain failures, with an error code and message. Native
post-admission errors preserve `accepted`/`notAccepted` evidence in `details`;
missing evidence means uncertain admission, not failure to admit. Stop and Close
do not depend on a successful ordinary snapshot read.

The core protocol is in
`development/tandem/runtime-src/application-interface.ts`, which both packaged
owners can reuse without a reverse dependency on the integrated host.
`src/application-interface.ts` owns upstream operation metadata and shared draft
eligibility. `human-loop-application.mjs` owns native operation metadata and
reuses the native projected state. Each provider has one data-only dispatcher;
HTTP parsing, SDK tool results and canvas calls are adapters, not copies of
workflow logic. No new dependency, scheduler, model prompt or persisted state
format is introduced.
