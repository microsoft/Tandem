# Tandem shared runtime modules

Tandem's only supported product entry point is the project extension in
`../../.github/extensions/tandem`, implemented under `..`.
Its canvas and regular-browser views use the same current human-loop runtime.
See [installation and browser setup](../INSTALL.md).

The old standalone HTTP server, Copilot session host and separate `public` UI
have been removed, along with their `start` and `dev` scripts. The inactive
Canvas migration runtime and its private SDK adapter have also been removed.
This directory is
not a second runnable web application or a standalone behavioral oracle.

## Retained shared code

- `domain/human-loop` supplies current request, role, result, authorization
  and ledger contracts.
- `domain/host-state-*`, event storage, project policy, execution budgets and
  attachment stores supply persistence and runtime services.
- `permissions` supplies the permission broker. The pinned Copilot SDK remains
  required for its implementation/types; it is not a
  replacement for the installed SDK used by the extension.
- Backbone schemas, artifact storage, implementation evidence and retained
  workflow contracts remain transitive shared dependencies. Retirement
  of the old server does not authorize deleting saved state or changing its reads.
- `../skills` remains bundled authoring/review guidance, and `../test/shared` covers shared
  domain, persistence, permission and compatibility behavior.

This is not an unchanged copy of the old application. `domain/human-loop`
contains the current lifecycle contracts; the WAL is later shared infrastructure.
The older permission broker, event store and compatibility schemas have evolved
and are still imported by current Tandem. Historical folder names do not mean
the removed host is running.

The extension packager follows relative imports into `runtime-src`, including transitive
dependencies; it does not copy the whole shared source directory. It also bundles
the skills. Keep runtime imports natively loadable by Node 24 and preserve the
strict TypeScript build.

## Validate

From the `tandem` workspace:

```powershell
npm run build
npm test
```

From `tandem`, `npm run test:shared` runs this shared suite and
`npm test` runs the shared suite followed by canvas tests. These tests
do not launch an old web host or establish real native/model end-to-end behavior.
Historical design documents and research remain historical context, not startup
instructions for another supported product.
