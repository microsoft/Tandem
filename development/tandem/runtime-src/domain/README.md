# Shared Tandem domain

`human-loop/` defines current request admission, authorization, role/result
contracts and durable ledger transitions. The executing runtime is under
`tandem/src/human-loop-*`; this directory is not another application.

`host-state-file.ts`, `host-state-wal.ts` and `product-paths.ts` own shared
persistence, writer ownership and retained workspace-name compatibility.

`workflow/` supplies the policy contracts, execution budgets, attachment stores
and retained data schemas imported by current Tandem. `backbone/` and
`implementation-review.ts` remain transitive schema/storage dependencies:
for example, foundation storage imports the artifact store's rename helper,
and policy schemas import the retained implementation-review schema.
That dependency does not execute the retired Router, host or reviewer.

The old classifier, standalone host, isolated-worktree orchestration and private
SDK transport have been removed. Preserve versioned data validation and saved
history; do not restore a retired execution path to read compatibility data.
