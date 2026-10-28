# Pre-release cleanup

## Authorization and provenance

The user authorized execution of **all pre-release code, docs, packaging and
test cleanup**, leaving Git history and directory layout unchanged.

The original audit was recorded on **2026-10-27** against `a9973e6`
(`a9973e6789a1b642dbd938416221bd5b85d23635`, 698 tracked files). It is
historical evidence, not the current source snapshot. Cleanup starts from clean
`main` at `71c33d70018fe65a16c75254d0f31d6cc741bcb2` (723 tracked files),
verified against `origin/main` on 2026-10-27, on `liqul-pre-release-cleanup`.

The user subsequently authorized committing this cleanup, opening a review PR and
launching an isolated blank manual preview of its exact published head before
merge. This does not authorize a version bump, release, deployment, global install,
repository visibility change, history rewrite, branch deletion or merge.
Installed `stage2/` payload paths, IDs, schemas and saved history remain intact.
Other source/media/manual-test worktrees and the private Azure backup are outside
this cleanup. Local tests and packaging are not live native qualification,
security certification or a public release.

## Implementation

- [x] **ZIP completeness:** include `preview-launcher.mjs`; extract the actual ZIP
  and run `verifyPayload` with version and required-file assertions.
- [x] **Obsolete shipped skills:** confirm and remove retired implementation
  review/lifecycle/index and design-impact guidance; update presence tests and
  regenerate manifests while preserving current Design skills and read-only Review.
- [x] **Dead evidence layers:** recheck production imports, dynamic/resource
  references and packaging; remove only dead `execution-proof` / `verification`
  code, dead-only tests, types and config entries.
- [x] **Retired process mutations:** remove unreachable acceptance/capture/export/
  delivery handlers and dead-only tests/helpers. Preserve HTTP 410 compatibility,
  history/schema readers, adapters and their receipt history.
- [x] **Public documentation:** complete the Development tasks below and remove
  retired controls/escalation instructions from current usage guidance.
- [x] **Live-eval dependency drift:** resolve CLI/SDK from repository manifests;
  remove stale version comments. Do not run paid/live evaluations.
- [x] **Fixtures and UI tests:** repair stale cross-platform fixtures and assertions
  against the intended current UX; investigate remaining failures without restoring
  retired controls, auto-escalation or bypassing implementation confirmation.

### Development

- [x] Replace reader-facing Stage 2 terminology with **Development** in READMEs,
  public guides and contributor instructions; preserve technical `stage2` names.
- [x] Remove internal discussion/process documents and presentation HTML from the
  public-facing tree, preserving useful current usage/setup/architecture guidance.
- [x] Remove `development/stage1-integration-plan.md` and carry current handoff
  boundaries into maintained guides.
- [x] Reconcile links/indexes; correct the retired outcome-export recipe and the
  obsolete denial of implemented bound handoffs.
- [x] Preserve approved README introduction, both hosted videos, theme-aware logo,
  branding sources, public illustrations, application HTML, vendor licenses/notices
  and contributor provenance.
- [ ] **Post-release only:** consider renaming `development/tandem` to
  `development/app`. Explicitly deferred; no flattening or directory rename here.

## Validation

Implementation evidence:

- ZIP packaging now includes the preview launcher and root license. The extraction
  regression checks every payload hash, release version, matching installed skill
  and license; deleting the extracted launcher makes verification fail. CI runs
  this actual extraction check after packing, not just a manifest-presence test.
- Removed five obsolete skills: `implementation-reviewer`,
  `implementation-gap-reviewer`, `implementation-lifecycle-reconciler`,
  `implementation-index-maintainer` and `design-impact-classifier`. Packaging
  asserts their absence while retaining current Design skills and vendor assets.
- Current source/reference inspection found no production consumers of
  `execution-proof.ts` or `verification.ts`. Removed them, their dead-only tests
  and the unused test type/config entries. Removing the unreachable process
  handler also disconnected the delivery builders in `delivery.ts` and
  `development-delivery.ts`; these and their dead-only tests were removed.
  Shared fingerprint/scheduling/adapter code and historical state readers remain.
  The HTTP 410 regression retains adapter selection, receipts, automatic-execution
  flags and protected-source history, and proves no work is dispatched.
- Removed the two internal presentation decks, `workflow-redesign.html`, the
  integration progress plan and their orphaned `model-y-source.png` capture.
  Replaced the long internal prompt-change log with a concise production-source
  contributor guide. Current handoff and ownership contracts remain in maintained
  guides and agent instructions, including teleos source provenance.
- The live job now uses the SDK/runtime restored by `npm ci` from the lockfile,
  without an independently pinned global CLI. Deterministic CI also restores the
  Development compiler dependencies. No live evaluation was run.
- UI fixtures now use current review panes, Structure selection, combined
  draft approval, private-only history/permissions, identity-based status and
  real background colors. Original assertions for exact requests, retained edits,
  source-bound images, no implicit work, geometry, contrast and keyboard access
  remain. Real regressions fixed: hidden Apply-blocker explanation, focused stage
  tabs outside their scroller, short-window review panes crowding previews,
  cramped sidebar labels, native composer focus-ring placement and shared
  selector specificity misaligning native history controls.
- Test synchronization now follows actual capture requests, owned browser-document
  readiness and published recovery events. The recovery fixture reuses the SSE
  reader instead of repeatedly opening a state file while Windows is replacing it.
  Browser cleanup uses the existing owned fixture teardown rather than racing an
  extra CDP close acknowledgement. No checks were disabled to obtain these results.

Final validation on 2026-10-27, Windows with Node **24.22.1**:

| Check | Final result |
| --- | --- |
| Complete root test inventory | **1,120 passed, 0 failed, 6 skipped** |
| Complete Development shared inventory | **216 passed, 0 failed, 0 skipped** |
| Complete Development canvas inventory | **1,120 passed, 0 failed, 2 skipped** |
| Focused lifecycle/recovery and streaming tests | **46 passed, 0 failed** |
| `npm run check` | Passed |
| `npm --prefix development\tandem run build` | Passed |
| `npm run pack` (includes root check/build) | Passed; version remains **1.1.15** |
| Actual ZIP extraction and payload/relocation tests | **7 passed, 0 failed, 1 skipped** |
| `npm run eval` | Six valid fixture cases; inventory only, no model calls |
| Local Markdown links | 101 checked in 31 maintained source documents; none missing |
| Protected source and diff checks | README introduction/videos/branding unchanged; dependency manifests, vendor assets and license text unchanged; whitespace check passed with existing CRLF endings allowed |

The root suite ran all eight entry files from `package.json`'s `test` script using
`node --import tsx --test --test-concurrency=1`, with no test-name filter.
Development ran both normal inventories from `development/tandem`:
`node --import tsx --test --test-concurrency=4 test\shared\*.test.ts` and
`node --test --test-concurrency=4 test\*.test.mjs`. File concurrency was bounded
for this shared Windows machine; concurrent-behavior tests inside those files
were retained. Earlier failing runs exposed fixture synchronization problems;
the final complete runs above are after their corrections.

The broad root run's six skips are package-gated tests. ZIP extraction and
controller relocation were then activated with `TANDEM_PACKAGED_ZIP` and
`TANDEM_PACKAGED_EXTENSION`. The standalone npm tarball and three additional
package-gated Git/handoff browser checks were not exercised. Development's
two skips require an opt-in daily replay or an external frozen debugger baseline.
Skipped cases are not claimed as coverage. Browser checks here use local synthetic
fixtures, not the separately running manual native test. Linux CI was configured,
not executed here.

The local `dist\tandem-extension.zip` SHA-256 is:
`01AF22328A3C3796D2740D4A66474B2C840DDB89F2E5D3A18F337844698F022A`.
Detailed results are retained in session artifacts:
`release-cleanup-root-suite.log`, `verified-development-suite.log`,
`verified-lifecycle-tests.log`, `verified-pack.log` and `verified-zip.log`.

The cleanup was published as commit
`947b2572b424661c815dd1506d9d503df2035561` in
[PR #60](https://github.com/microsoft/Tandem/pull/60). Follow-up findings and
validation below are separate from that published candidate.
Historical CI/local counts from the original audit are not these results.

## Review PR and manual qualification

The validated implementation is unchanged for PR publication; only this tracker
records the new authorization. `origin/main` was rechecked on 2026-10-27 before
publication and still matched `71c33d70018fe65a16c75254d0f31d6cc741bcb2`.
The PR's live head commit, not the version label alone, identifies the candidate.

- [ ] Linux CI and code review pass for the published head.
- [x] Launch a fresh blank target with `--source-preview` from that exact head;
  record its source SHA, complete payload digest and native identity separately.
- [ ] User manually checks startup, Designs/Prototype review, private Development
  requests, implementation confirmation and Review on that candidate.
- [ ] Merge only after CI, review and manual evidence agree on the same commit.
- [ ] Smoke-check the final `main` build before any separately authorized release.

Preview setup may stop at native trust/auth/permission prompts. HTTP availability
and staged file integrity alone are not a completed integration handshake.
Do not select a model, effort, stage or goal, submit project work, or answer native
consent on the user's behalf. The existing older-build manual test is not evidence
for this candidate and must remain untouched. Exact launch/PR receipts belong in
session artifacts; capability-bearing URLs stay in the preview browser/terminal.
Any later source commit requires fresh candidate-bound manual evidence.

## Manual-feedback follow-up

The user rejected the extra Prototype-to-Development transition steps while
manually testing PR #60 at `947b2572b424661c815dd1506d9d503df2035561`.
That manual run is not a pass and remains alive on its original payload.
The user authorized separate ordinary CI and transition/model commits, followed
by a normal merge of current main and a fresh exact-head manual preview. The
original preview must remain untouched; nothing is globally installed.

- [x] Combine Finish Prototype, exact internal handoff retention and normal
  Designer admission into one user action; remove the intermediate review popup
  and mandatory model/start controls. Keep native consent, normal Design review
  and the later implementation confirmation.
- [x] Persist generation/request/snapshot-bound Finish intent. Duplicate clicks
  reconcile the same request; interrupted/failed startup retains source and
  errors for explicit retry, not automatic replay on reopen.
- [x] Apply the user's final model policy: two optional Main/Development selectors
  in the same Project settings window; first private creation uses its explicit
  override or inherits main's actual current model, then remains independent.
  The earlier GPT 5.4 floor, mandatory early model selection and private-native-
  default proposals were superseded. Effort is not copied.
- [x] Read models and effort from the owning native APIs and show compact current
  readouts; not-started, unreported defaults, pending changes and errors are not
  presented as applied settings.
- [x] Finish bounded source validation and review the diff before publication.
  Preserve the remaining qualification limits below.

### Follow-up validation and residual limits

Validation completed on Windows with Node 24.22.1. Per the user's instruction to
reduce repeated runs, the complete inventories were not rerun after targeted
corrections. These results are not a claim of final green Linux CI.

| Check | Result |
| --- | --- |
| Root check, Development build, generated extension and final `npm run pack` | Passed; version unchanged at **1.1.15** |
| Transition, handoff, entry and renderer coverage | **123 passed** |
| Final optional-settings, effort, header/readout and portable-path coverage | **52 passed** |
| Actual merged-host and embedded-workspace browser cases | **2 passed** on focused rerun |
| Complete root inventory through the new isolated runner | **1,112 passed, 12 failed, 6 skipped**; completed without heap exhaustion |
| Complete Development canvas inventory | **1,131 passed, 2 failed, 2 existing skips** in 12m44s |
| Corrections for both native-suite failures | Settings heading/tab order and the 320px composer layout each passed their targeted browser check |
| Final exact-identity checks | First Finish admission, refused/interrupted startup without replay, and same-ID saved-model resume passed |
| Final ZIP extraction and payload integrity | Passed; relocated controller/module loading also passed |

The root run exposed ten obsolete or overly broad UI expectations, corrected
and covered by the focused passes above. Its embedded resize assertion passed
on focused rerun; an intermittent acceptance-lock `EPERM` also passed alone
after failing twice under concurrent validation. The acceptance implementation,
fixture and runtime imports are unchanged from published HEAD. No lock redesign,
test disabling or force-exit workaround was applied. Those intermittent
observations remain visible; a passing isolated test is not an all-green full
run or proof of the race's root cause.

The native run found the renamed **Models** heading and the newly crowded
composer row. Updated assertions include the new Refresh models keyboard stop;
the current-value readout now uses the existing conversation header, leaving
Stop and current-status navigation in their original row. Both focused browser
checks passed individually, not in one all-green combined run:

| Corrected case | Existing passing evidence |
| --- | --- |
| `current status is quiet inline navigation in the composer action row` (includes 320px) | `followup-final-native-layout.log`, line 2; tool receipt shell 69. This same run still failed the separate Settings tab-order assertion at line 2061. |
| `Settings sections distinguish access status from its action across narrow and wide panels` | `followup-final-settings-layout.log`, line 1; tool receipt shell 71, **1 passed, 0 failed**, after the Refresh models tab-stop correction. |
| Refused/interrupted Finish recovery without replay | `followup-interrupted-recovery-final.log`, line 1; tool receipt shell 65, **1 passed, 0 failed**. The earlier fixture failure remains in `followup-final-targeted.log`. |

The complete shared Development inventory was not rerun because its
implementation is unchanged.

The final local payload contains **156 files**, digest
`93ca62c40a73385b0f73002fe666f1ee97b5489600a584a6a76431327c2651ca`.
The final ZIP SHA-256 is
`A49FEC67C84A6D2C24E8E7E1BEA6CCB20AB7275CD221248DA3F9ECF89635D6EA`.
Neither replaced the running PR preview. Logs remain in session artifacts:
`transition-full-root-first.log`, `transition-development-full.log`,
`transition-focused-tests.log`, `transition-current-ui-tests.log`,
`transition-layout-tests.log`, `acceptance-unchanged-baseline.log`,
`followup-final-targeted.log`, `followup-interrupted-recovery-final.log`,
`followup-final-native-layout.log`, `followup-final-settings-layout.log` and
`followup-final-pack.log`. Earlier failures in these logs are not erased.

Linux CI, review and renewed user manual qualification remain required on a
subsequently published exact commit. No live or paid model validation was run,
and native consent or implementation approval was not granted on the user's
behalf. The original manual preview remains at `947b257`. A newer published head and
fresh preview require their own exact-commit receipts; old manual evidence is
not transferred.

### Independent Linux CI correction

PR #60 run `40461720524` failed on Linux. The concrete assertion was
`tests/prototype-lifecycle.test.ts:122`: the fixture used native `join()` but its
expected `previewStart.entrypoint` still hardcoded `app\\server.mjs`. The expected
path now uses `join()` too; the required restart behavior is unchanged.

Separately, Node PID 2499 exhausted its approximately 2 GiB V8 heap after the
large `tests/index.test.ts` process had accumulated the renderer suites. Other
entry-file processes continued and the earlier path assertion was still
reported; the heap failure did not cause that path mismatch. The old run's
partial total is not complete coverage.

`npm test` now expands the unchanged index inventory into separate Node test
processes, adds the same seven existing direct entries, and bounds concurrency
to two. This releases each suite's renderer/VM heap between processes without
skipping tests or increasing the heap limit. The existing monolithic index
remains available for diagnosis. Changes to any script now trigger CI.
Run/log evidence is retained as `pr60-linux-ci-failure.log` in session artifacts.
Linux CI has not been rerun for this follow-up, so merge remains
blocked on a new published head, CI, review and renewed user manual qualification.

### Current-main integration and fresh preview

Publication preflight found main advanced from `71c33d7` to
`a9f718bc30f835d670d21e2f4de8730ff512eb3c` (PR #59, navigation styling and
resizable Design sidebar panes). The user explicitly chose to integrate main
now and check only the affected UI seams. The two reviewed follow-up commits
remain separate from that ordinary merge; no amend, rebase or force push is
authorized.

Preserve both the navigation/sidebar changes and the cleanup's readable
status/model controls. Regenerate emitted payloads from resolved source.
Pre-integration results above cover unchanged content, not an all-green
qualification of the merged candidate. Record narrow integration checks and
the fresh preview's source/payload/native identities before manual handoff.

The reviewed CI correction is commit `c069b58`; transition/model settings and
the user-requested README launch-option example are commit `fd9b6eb`.
The ordinary main merge preserves PR #59's shared tab bars, navigation states
and resizable sidebar, along with the cleanup's compact review bounds, readable
sidebar labels and native model/status controls. Source conflicts were resolved
in `src/renderer/ui/layout.css` and `tests/renderer.test.ts`; emitted payloads
were rebuilt rather than hand-merged.

Integration qualification on 2026-10-27:

- The affected navigation, sidebar, focus, Finish and current-readout selection
  ran **16 tests: 15 passed, 1 failed**, with no skips. The new sidebar case's
  synthetic End-key step did not settle. Using native browser keyboard events
  after focusing the owned test page preserved its exact selection/scroll
  assertions; that single case then passed. Logs:
  `integrated-main-ui-seams.log` and `integrated-main-sidebar-final.log`.
- `npm run pack` passed type checking and regenerated source packaging.
  Actual integrated ZIP extraction and `verifyPayload` passed. No full
  inventory or live/model evaluation was rerun.
- Version remains **1.1.15**, with **156 payload files**, digest
  `f98c8d4d73d66dedddbc196d9f187a7db827bbd1f4b93e3d72a216f817c47dc9`.
  ZIP SHA-256:
  `41103D049E7FBA7ACE37ED3445759B1029D03C0493836C3D0B8F4AC0C47FC47B`.

The user requested a **fresh test**, not a restart of the old one. Publish the
normal merge to existing PR #60 and build its browser preview in a separate
commit-export directory so the active `947b257` browser runtime is not
overwritten. The new launch receipt and PR body bind the exact merge SHA,
main base, payload and native identity. Stop at initial UI or actual native
consent; Linux CI, review and user manual qualification remain merge gates.

## Startup/preflight recovery follow-up

The `8053076` manual test exposed a real ordering bug: private creation was
durably marked requested before inheritance validation, which then failed
without calling `client.createSession`. The failed runtime object also disabled
the Development override the error recommended.

The source correction:

- Validates model inheritance/catalog/API readiness before consuming native
  creation intent. Proven not-requested failures keep optional Settings usable,
  including after reopening; explicit retry retains the reserved identity.
- Reuses the existing inspected, one-time initialization confirmation for the
  exact old missing-main-model v3 failure. It checks complete history, stops the
  failed creator, verifies native metadata/in-use/storage absence, rejects
  present or uncertain state, and preserves the original issued receipt.
  Recovery never automatically admits the handoff or approves implementation.
- Makes an unselected standalone main concrete at startup using the owning
  native preferred model and verified native switching/readback, before project
  UI or private creation. Existing main selections and explicit launch choices
  are preserved. No fixed model, copied parent-chat preference, forced effort or
  per-worker model override is introduced.

The focused nine-case group passed eight cases; its empty-catalog test expected
different error wording. That one assertion was corrected and passed alone.
The two recovery cases also passed after adding cold-settings/reopen guards.
Root type checking and the Development build passed. Logs:
`startup-recovery-default-final.log`, `startup-default-error-final.log` and
`startup-cold-recovery-final.log`. No full suite was rerun.

A separate supported read-only native lookup on 2026-10-27 at 09:17:41 UTC
reported reserved private ID `8aec0704-adc8-4bab-95b5-62098a114362` absent in
metadata, in-use ownership and storage. Its inspection client closed cleanly.
This diagnostic is not recovery authorization; the UI rechecks before and after
the user's explicit confirmation. Evidence:
`pr60-8053076-manual/reserved-native-lookup.log`.

The user authorized ordinary publication, a safe restart of only the blocked
`8053076` host using the same project/main/private identities, and a separate
blank direct-entry test on the new candidate. This does not authorize recovery
confirmation, handoff submission, project work, PR merge or auto-merge.
Before stopping, verify idle main work and authoritative absence for the
reserved private ID; preserve identity/artifact hashes and the original journal
prefix across the ordinary relaunch. Keep the old `947b257` preview untouched.
After loading the corrected source into the
same project, use **Inspect unused setup recovery**, review the original ID,
then **Authorize one-time initialization**. After Ready, click the retained
handoff action once (**Retry Development** for the failed prepared intent;
**Reconcile saved request** only when admission is uncertain).

Recovering this poisoned receipt is not a pass for normal transition behavior.
Two manual cases remain on the next candidate: normal **Finish Prototype ->
Development**, and a fresh direct **Go to Development** with no launch overrides.

## Follow-up UI fixes (separate PR after #60)

The user superseded the request to finalize PR #60 with
**"no need, we shall have another pr"**.
[PR #60](https://github.com/microsoft/Tandem/pull/60) merged on 2026-10-27 at
`ad3977b72fd241f10ae640eb45cbc093ac15aeee`. This separate follow-up contains
the source, test and generated changes below; they were not part of merged
PR #60. Earlier **"seems ok"** feedback is not a blanket manual-test pass.

- Disable Preparation only for saved direct-Development entry, redirect stale
  unused-Preparation navigation, and retain Preparation-first history.
- Honor native recovery capabilities instead of offering an invalid handoff
  Retry; show the existing recovery action and inspection progress. After Ready,
  label the retained submission **Continue saved Prototype**.
- Reuse the two passing focused navigation checks and the passing recovery-CTA
  regression. Cross-phase fixtures now explicitly model Preparation-first entry
  with an existing Development context rather than calling it direct entry.
- The prior local `npm run pack` passed type checking, source build and payload
  generation. That run and the focused checks above are reused unchanged-content
  evidence, not reruns on this follow-up commit. Version remains **1.1.15**.
- Publication checks verified the preserved patch's SHA256 and all 14 applied
  Git blob identities, plus the merged base's tree equality with `950db97`.
  Dependency-free checks verified all 156 composed-payload and 152 Stage 2 file
  hashes/sizes, the canonical payload digest, matching changed native asset copies,
  and `git diff --check`. Only this publication-status text differs from the patch.
  No dependencies were installed, tests/builds/packaging rerun, previews restarted,
  or user installations changed.
- CI passed for `950db97`; this follow-up requires its own PR CI result.
  Existing failed/intermittent results above remain historical limits.

A read-only observation of the user's `950db97` TinyBoard fixture showed
Prototype completed, `generate-design-spec` succeeded and the saved transition
intent admitted, bound to `prototype-r69.json` and
`handoff-32a62412adab6950320b6bfa57e13bce4788e8641ac41c5d99c8ac4b9ac9f27c`.
The agent did not click Finish. This evidence and all preview receipts remain
bound to `950db97`, not silently transferred to the follow-up UI changes. PR merge,
final review and interpretation of manual coverage remain with the user.

### PR #62 CI fixture correction

[Run 40496393843](https://github.com/microsoft/Tandem/actions/runs/40496393843)
on `f1222b64da4a610df00ccd616d71a5926a62f6d2` reported 1,103 passing, one failing
and 29 skipped tests. The sole failure was the permission-ownership fixture at
`tests/standalone-header.test.ts:130`: it selected direct Development entry but
expected the intentionally disabled Preparation panel to open.

The exact assertion was reproduced locally after `npm ci --no-audit --no-fund`
restored missing locked root dependencies. The fixture now uses the existing
Preparation-first entry with retained Development context and explicitly checks
that Preparation is enabled. All private-session permission assertions remain
unchanged; no runtime or generated payload changed.

One targeted run passed all four selected cases: permission ownership, persisted
direct Development entry, retained Preparation-first history, and recovery CTA.
No full suite, release build, packaging, native/manual preview or paid model test
was rerun. The correction still requires its own PR CI result.

### Current-main integration for PR #62

The fixture-correction head `522853c` could not start fresh PR CI because current
main conflicted in generated `extension.mjs` and `payload.json`. The authorized
normal merge integrates `72a42fa87a6ecc78a7da33f20914f0f4e9241a1b` without rebasing
or force-pushing. Maintainable source merged without conflicts; main's review
behavior and the two UI fixes remain. Unmerged API refactor `00f0284` is excluded.

`npm run check` and `npm run build` passed. The build regenerated both conflicted
files from merged source rather than selecting either stale payload. Root version
remains **1.1.15** and the Development package version remains **0.1.0**.
Production payload verification and nested-manifest checks verified all 156
composed and 152 Stage 2 file identities, the digest and changed native asset copies.

One targeted run passed five cases: persisted direct-entry navigation,
Preparation-first history, upstream-review feedback in the bottom pane, pinned
earlier-stage review navigation, and actual generated-payload relocation. The
unchanged permission-ownership and recovery-CTA cases reuse the preceding
four-case pass. PR-relative whitespace checks passed; inherited main-only source
was preserved. No full local suite, release ZIP, native/manual preview, deployment
or paid model test was run. Fresh PR CI must report against the integrated head.

## Public-release history (unexecuted; separately gated)

- [ ] Decide between a new public snapshot and a controlled rewrite of the existing
  repository. No history operation is authorized by this cleanup.
- [ ] Refresh and verify the private Azure backup immediately before cutover.
  The prior backup at `https://dev.azure.com/LLMCube/Exploration/_git/Tandem`
  retained 37 GitHub branches, 0 tags, 228 reachable commits and 4,321 exact Git
  objects at main `ef59b77`; old Azure main was separately archived. Uncommitted
  files, including the parent's original checklist, were excluded.
- [ ] Review the final publication snapshot, credits, provenance and licenses.
  Do not absorb the separate unmerged release-root documents workstream.
- [ ] Decide how to handle old branches/tags, PRs, cached references and collaborator
  cutover before any authorized publication or visibility change.

## Unattended release qualification - 2026-10-28

The user authorized one prioritized test/fix pass, not publication, deployment,
history changes or a version bump. This pass fetched and verified clean main at
`72a42fa87a6ecc78a7da33f20914f0f4e9241a1b`, tree
`4a2be9a9d7947017d2f24192b8237c3f90296e36`, version **1.1.15**.
This includes PR #61, whose deterministic CI was green at `a74f41a9`.
PR #62 was separate, unmerged work when qualification began: its earlier permission-header failure was
classified and corrected by its owner as a fixture/start-path mismatch, not a
proven permission regression. Its head `b18493c8` subsequently passed deterministic
CI and merged as `32f2039306de9408f25cbca9598db44968e9afba` (tree
`36798cb52411276ddfecdf3ae7e5bf4fda501aff`). The final fetch records that newer
main without merging it into this qualification worktree or transferring the
earlier evidence to its UI changes. Its private creation/transport source and
dependency manifests are unchanged from the tested candidate. The incoming application-interface change
`00f0284` is also excluded.

### Release blocker: unused native Development does not survive clean reopen

- **Observed:** actual isolated source-preview startup in a fresh empty target
  verified the exact session provider and payload, activated/read back the native
  preferred main model, completed consented Git setup and reached private
  Development **Ready** without a model turn. Orderly host close completed.
  Reopening the same target retained the main identity and discovery generation,
  but the original private identity became unavailable. The application preserved
  that identity and reported `unknown` / `execution-unknown`; it did not replace
  the session or submit work.
- **Impact:** a user who opens Development, closes it before sending a request,
  then returns can be stranded at recovery. This is a release blocker, not a
  passing native journey.
- **Narrow diagnosis:** supported native metadata, in-use and storage APIs
  confirm the private ID is absent after close. A separate no-model probe found
  that create/name/readback succeed while `sessions.save` returns `{}` and
  metadata/storage remain absent even before shutdown. The documented
  `workspaces.ensure` operation does not change that result. The SDK save
  contract flushes an existing writer and explicitly permits a no-op when none
  exists; RPC success is not durable journal evidence.
- **Supported notification probe:** one truthful `session.rpc.log` notification
  with `ephemeral: false` returned an event ID and appeared once as `session.info`.
  Save still returned `{}`, and native metadata/storage remained absent both
  before and after clean shutdown. No further event variants were tried.
- **Status:** unresolved. Original failure receipts and workspace WAL are
  preserved. The supported SDK/runtime persistence boundary requires a fix;
  no speculative production workaround was applied. No dummy prompt, replacement
  identity, automatic reset or direct native-storage write was used.

The opt-in regression uses the production private-creation helper and real
native create/name/save/stop APIs, then checks the exact identity through a cold
client before attempting resume:

```powershell
$env:TANDEM_NATIVE_DURABILITY = '1'
node --import tsx --test tests\native-durability.test.ts
Remove-Item Env:\TANDEM_NATIVE_DURABILITY
```

It intentionally makes no model request and grants no permissions. The final
run failed at the missing cold metadata assertion with clean client shutdown,
not at a mock or a timeout. Its first diagnostic run hit the initial 60-second
whole-test deadline while closing; that evidence is retained. The test now
allows 180 seconds for both native client lifecycles and cleanup; production
timeouts are unchanged. Without explicit opt-in this test is skipped, never
counted as a pass. Existing test inventory expansion/concurrency is unchanged.

### New evidence and limits

| Distinct coverage | Result |
| --- | --- |
| Root metering, startup, model/effort, recovery, handoff and acceptance boundaries | 181 passed, no skips |
| Native model/settings/recovery/permission fixtures | 80 passed, no skips |
| Current PR #61 review, DSL, Design updates and Prototype/Finish flows | 128 passed, no skips |
| Actual ZIP and standalone tarball extraction, controller relocation and packaged Git/handoff browsers | 27 passed, no skips, including both entry paths across eight Git scenarios each |
| Actual artifact fit/overflow, narrow storyboard and source-bound document browsers | 10 passed, no skips |
| Missing-prerequisite production-factory normalization regression | 1 passed |
| Root check/pack, browser pack and Development build | Passed; no version change or generated-source drift |
| Maintained Markdown file links and packaged CLI options | 101 links in 16 guides resolved; help/options checked |
| Actual no-model source-preview/direct Development/clean reopen | Failed at private reopen; startup/main readback and first private Ready were observed |
| Opt-in production-helper native durability regression | Failed at absent cold metadata; 0 skipped/cancelled in the final run |

Browser fixtures use the actual packaged/source renderer with synthetic native
adapters unless explicitly labeled actual native above. They do not establish
model-driven implementation, Review or permission acceptance. The historical
acceptance-lock race did not reproduce in this bounded core group; that is not
proof its root cause is resolved. No broad suite was repeated merely to obtain
another green count.

Four serial **gpt-6.1-sol** prompt-only cases consumed **4.08507 actual AI
credits** (`4,085,070,000 totalNanoAiu`) in the existing metered runner. New GUI,
existing GUI and non-GUI probes passed. Missing-prerequisites failed only its raw
readiness label; all explicit deferral/no-invention checks passed. Production's
existing factory overrides a worker's `ready` label when upstream checks are
`missing`; the added regression verifies that exact receipt-bound path still
advances to Requirements with `needs-attention`. The raw probe failure remains
recorded and is not represented as a native user-flow failure or rerun for green.

The assignment has **two unused live cases and 15.91493 credits remaining**,
with no overshoot or unknown usage. Each case had a 1,200-second limit including
startup. Full native model-driven journeys remain unrun: the product surface
does not expose supported aggregate main/private/factory credit accounting for
this shared budget. No alternative evaluation framework or unmetered model
fixture was created.

Dependabot metadata shows **14 open alerts: 5 high, 6 medium, 3 low**, not
exploitability findings. Runtime `zod@4.3.6` appears through the SDK in both
lockfiles; other affected paths include `undici`, `brace-expansion`, `fast-uri`,
`ajv` and `katex`. Dependency triage, final native qualification, review of the
separate incoming changes, public-document/provenance review and explicit
publication approval remain outstanding. This pass is not security certification
or a declaration that the repository is bug-free.

Detailed matrix, actual-usage ledger and receipts are retained in the release
qualification session artifacts: `qualification-matrix.md`,
`qualification-ledger.json`, `qualification-live-report.json`,
`native-startup-receipt.json`, `native-owned-metadata.log` and
`native-durability-probe.json`, plus `native-lifecycle-probe.json` and
`qualification-native-regression-final.log`. Individual test logs preserve both failures and
passes. The exact candidate payload digest is
`92aa5919cb0654220cef56a2c37a3534765e598206a13743508704f4a994ae9e`;
ZIP SHA-256 is
`4A17EE97115A06C1C0DFE13DEC938CDD323D65145D0961899CDF4EE377B415DC`;
standalone tarball SHA-256 is
`B9EDDCDCF6F8547210E34CCDBD6379F943B004F15FBFD227745B082224EB5999`.
