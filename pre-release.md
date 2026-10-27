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

The cleanup is prepared for commit and review PR publication, based on the source
SHA recorded above. No known cleanup implementation blocker remains.
Historical CI/local counts from the original audit are not these results.

## Review PR and manual qualification

The validated implementation is unchanged for PR publication; only this tracker
records the new authorization. `origin/main` was rechecked on 2026-10-27 before
publication and still matched `71c33d70018fe65a16c75254d0f31d6cc741bcb2`.
The PR's live head commit, not the version label alone, identifies the candidate.

- [ ] Linux CI and code review pass for the published head.
- [ ] Launch a fresh blank target with `--source-preview` from that exact head;
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
