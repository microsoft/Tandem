# Tandem Stage 2 instructions

These instructions apply within `stage2/`. All paths below are relative to this
directory, which retains the original source layout. Stage 1's surrounding
`src/`, root package, generated extension and release process are separate.
Use this subtree's `tandem/package.json` and lockfile; do not modify Stage 1 to
build or test Stage 2. Do not activate the nested discovery shim or overwrite the
Stage 1/user-wide extension without explicit authorization.

## Scope and direction

- `tandem` is the single maintained application/package root, with one package manifest, lockfile, and build/test setup. Its app canvas and ordinary-browser entrypoint are two delivery surfaces of the same extension, not separate workflow hosts.
- `.github/extensions/tandem/extension.mjs` is the required project discovery shim, pointing to `tandem/src/extension.mjs`. The extension and canvas ID are `tandem`. The active implementation is the `human-loop-*` family under `tandem/src` and its renderer under `tandem/public`.
- The old standalone web host, renderer, and inactive Canvas application are retired. Reused TypeScript modules live under `tandem/runtime-src`, skills under `tandem/skills`, and TypeScript tests under `tandem/test/shared`. Do not restore a second application workspace, standalone `npm start` path, or retired-host parity oracle.
- Before removing more legacy code, trace both direct and transitive imports, dynamic file paths, packaging inputs, and tests. A historical directory name does not make its shared modules unused.
- Historical teleos prototypes were deliberately not transferred. Their phase models and compatibility contracts do not constrain Tandem Stage 2.
- `docs/` contains the selected design documents, overview slides and image without nested folders. Check the active extension and tests before treating a note as shipped behavior.

## Build, package, and test

Use actual Node 24 or newer. Run the smallest existing test command that covers a change; the extension tests use `node:test` directly:

```powershell
node --check tandem\src\extension.mjs
node --test tandem\test\*.test.mjs
```

The unified workspace owns the TypeScript build and complete test commands:

```powershell
npm --prefix tandem run build
npm --prefix tandem test
```

The build is a strict TypeScript type-check with no output. Restore dependencies only after manifest changes or an actual missing-dependency failure. For focused shared tests, run from `tandem`, for example:

```powershell
node --import tsx --test test\shared\human-loop-model.test.ts
```

Build the complete portable extension into a new directory outside the source trees:

```powershell
npm --prefix tandem run package:extension -- C:\staging\tandem
```

The parent directory must exist and the destination must not. Follow `tandem/INSTALL.md` for installation and current platform/SDK requirements. Never deploy by raw-copying only `tandem/src` or the discovery shim; the package supplies relocatable `runtime-src`, `skills`, renderer assets, and its payload manifest.

Passing unit tests, syntax checks, or packaging does not establish native/UI qualification. Label synthetic fixtures, deliberate fault injection, and observed native behavior accurately. Do not change or reload a user's installed extension, restart their preview, or replace saved state just to validate source changes; use explicitly authorized, owned test resources.

## Active architecture

- `tandem/src/extension.mjs` registers the extension. `human-loop-installation.mjs`, `human-loop-runtime.mjs`, `human-loop-transport.mjs`, and `human-loop-provider.mjs` compose the current product. `human-loop-browser-entry.mjs` exposes the ordinary-browser surface.
- The owning Copilot session and Tandem's private native workflow session have distinct responsibilities. Opening Tandem creates its owned session but sends no project request until the user submits one.
- Main-session chat is not a Tandem request. Only explicit Tandem submission enters its request queue. Do not reintroduce a blanket main-chat question veto or a hidden chat-to-Router bridge.
- Controlled work requires the private session's real Interactive mode and readiness. Verify installed SDK capabilities rather than guessing APIs or using per-message metadata as a mode switch. Never change the user's mode.
- Native Copilot owns execution, scheduling, cancellation, and native consent. Keep Tandem thin; do not add a custom scheduler, supervisor, execution-certification framework, or speculative lifecycle gates.
- A valid terminal result bound to the current role/request is the sole normal completion authority. Validate identity and schema, persist/apply exactly once, and advance. Pending tools, child tasks, permissions, turn-end, idle, or quiescence are not additional completion prerequisites. Controlled role dispatch and the one-shot missing-result continuation explicitly use native `mode: "immediate"` with `agentMode: "interactive"`; attached background work must not strand a successor in the native enqueue path. This does not bypass Tandem's durable request queue or change the private session's mode.
- Missing-result recovery is a separate exception path: correlated native `session.idle` without the expected result permits one continuation in the same session, role, and request. `assistant.idle` never triggers it. A second missing result is reported, not automatically retried again. Result, Stop, and Close suppress a continuation; duplicate/delayed idle events are not fresh attempts.
- Immediate Stop invokes native interruption. After-step Stop stops at the declared role result without dispatching successors. Close attempts native shutdown even when saving or diagnostics fail; report saved and closed outcomes independently and honestly.
- Review has two goals: Design conformance and over-engineering. Direct review is appropriate for small/cohesive work. Optional read-only scopes use the native `tandem-review-scopes` factory: more than three total, but at most three concurrently, without a custom worker pool or retry manager.
- Reviewer announces its scopes visibly before delegating and publishes one consolidated report. Partial/unavailable coverage and child/parent failures must be honest and must not block later authorized work.
- Permission/read-only enforcement remains independent of result authority. Native session grants belong to the session; once-only consent remains invocation-only. Do not silently expand grants or convert missing permission into a successful action.
- Preserve exact retained conversation, Design, attachments, and native history independently of model-context compaction. Compaction is not permission to replace the visible audit with summaries.
- Supported same-session reopen retires old dispatch eligibility without replaying queued work or unfinished roles. The narrow exception is a pending implementation confirmation with no running role, Stop or uncertainty: preserve its request, but never execute without a fresh user decision; a changed Design invalidates/replaces the old card. Approved interrupted work is still retired. Reopen does not restore current project files, adopt old processes, or claim unfinished work completed. Preserve explicit ownership/history/writer errors.
- New implementation/resume/replan requests require a durable human confirmation before Planner or baseline capture, independent of tool permissions. Mixed explicit Change Design / Change implementation answers go to Designer first, then offer confirmation for the published Design. Preserve exact original questions, selected labels, implications and targets in Planner/Implementer reference context. Cancel records a Host status without sending a model turn or fabricating user text.
- `human-loop-store.mjs` owns durable workflow state. Preserve the framed workspace WAL, blob integrity, single-writer ownership, and truthful recovery records. In-memory views and event counters are not evidence that durable effects completed.
- `human-loop-app.js` owns the current browser client. Reuse shared renderers and artifact adapters under `tandem/public`; retain offline vendor payloads and licenses. There is no frontend application bundle step. Only artifact dependency updates require `npm --prefix tandem run build:artifacts`.

## Repository conventions

- Shared Design authoring uses `sketch-design/v3` with explicit `artifact/v1` Mermaid, HTML/CSS, or SVG sources. Preserve exact v1/v2 reads and unchanged shared-sketch artifacts. Follow `docs/supported-artifact-formats.md`; rendering is derived and annotations remain bound to exact source revisions/digests.
- Extension entrypoints must be named `extension.mjs`. Keep registration/lifecycle wiring there and implementation logic in sibling modules.
- Never write extension logs to stdout; it carries JSON-RPC. Bind renderer servers to `127.0.0.1` on an ephemeral port and preserve ownership and idempotent opening.
- The host supplies the matching Copilot SDK. Do not install another SDK merely to satisfy a runtime import. Use the installed SDK's actual supported APIs and exact CLI path.
- Shared TypeScript uses `NodeNext`, strict types, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`. Preserve Node 24-loadable transitive `.ts` imports and `allowImportingTsExtensions` where used.
- Persisted data and model/tool inputs are versioned and runtime-validated. Keep types, schemas, validators, and tests aligned. Corrupt or incompatible durable state must fail visibly, not be silently discarded or migrated without support.
- Preserve the existing atomic writes, WAL/transaction boundaries, and Windows file-lock handling. Never infer successful persistence from an in-memory snapshot.
- UI projections must not disclose reasoning, sensitive prompts, credentials, or unrelated native session data. Expose only the information needed by the user-facing surface.
- Tandem workflow questions belong in its Questions UI and durable workflow contracts, not an unrelated host `ask_user` interaction. This does not prohibit ordinary main-chat questions.
- Keep frozen qualification packages/receipts and user-owned previews unchanged. Source editing, packaging, installation, qualification, and deployment are distinct operations.
- Tests should use temporary, owned workspaces and preserve honest failure evidence. Never kill processes by name or adopt/terminate unrelated sessions during cleanup.
