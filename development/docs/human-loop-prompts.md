# Human-loop prompt source

The maintained model-facing instructions live in
[`tandem/public/prompts/human-loop.json`](../tandem/public/prompts/human-loop.json).
Edit that source, not copies in tests or internal discussion documents.
For current workflow behavior and invariants, use the
[runtime guide](../tandem/README.md) and [contributor instructions](../AGENTS.md).

## Ownership

| Section | Production consumer |
| --- | --- |
| `wrapper` | `human-loop-transport.mjs`: instructions followed by the exact serialized task packet |
| `shared` | `human-loop-runtime.mjs`: shared role context |
| `roles` | Router, Designer, Planner, Implementer (`task` and `aggregate`), Reviewer and Agent |
| `reviewScope` | Native read-only review scopes, not a separate workflow role |
| `sketchRules` | `public/sketch/contract.js`: shared document generation |
| `designRules` | `public/sketch/design-contract.js`: collection generation after `sketchRules` |

The browser-safe `public/prompts/human-loop.js` loader uses native JSON import
attributes. It validates the version, required keys and bounded nonempty arrays,
then deeply freezes the data. Missing or malformed assets fail explicitly; there
is no alternative prompt fallback.

Domain schemas, validation errors, dynamic messages, answers, Design data, code
evidence, packet serialization and input digests stay with their owning modules.
The domain tool schemas do not import public prompt prose. The host supplies the
SDK and its foundational instructions; these role prompts do not replace them.

## Behavioral boundaries

Requests to understand existing code or establish its Design use native read-only
exploration and the normal Designer publication flow. Observed code is evidence,
not automatically desired behavior or permission to execute scripts. Later
refinements preserve canonical Design and stable identities.

Design publication returns to the user. A new implementation/resume/replan request
requires durable request/Design-bound confirmation before Planner or baseline
capture. Implementer validates agreed journeys; Reviewer only reports Design
conformance and over-engineering with honest partial/unavailable coverage.
No shipped skill may restore the retired review-token, Attention/lifecycle
reconciliation or implementation-index mutation protocol.

A current identity-bound terminal result is the normal role-completion authority.
Native scheduling, consent, read-only enforcement and cancellation remain native;
idle, pending tools and background processes are not new settlement gates.
Missing-result recovery permits only the existing once-only continuation.
Stop/reopen preserves history but never replays retired authorization.

Use ordinary language for user-facing summaries, implications and questions.
Keep errors and uncertainty explicit. Do not rewrite exact IDs, schemas,
historical user text or technical artifacts to meet a wording preference.

## Deterministic checks

The fixture `tandem/test/fixtures/human-loop-prompts.before.json` is immutable
historical comparison evidence, not another prompt source. Tests extract the
production context builder through the package's TypeScript compiler API,
exercise transport assembly, and compare exact wrapper/packet text and digests.
Intentional changes require narrow assertions; never regenerate the historical
baseline from the current prompt.

From `development/`:

```powershell
node --test tandem\test\human-loop-prompts.test.mjs tandem\test\human-loop-transport.test.mjs
node --test --test-name-pattern="packages native JSON prompt" tandem\test\package-extension.test.mjs
```

Use the Development lockfile and compiler version. Local fixtures and package
imports do not establish a live model-driven journey. Live evaluations need
explicit model, case/time and credit limits.
