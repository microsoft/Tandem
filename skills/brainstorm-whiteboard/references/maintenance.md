# Host packaging and maintenance

Technical setup and checks for this standalone skill. Normal usage is in the
[README](../README.md); native HTTP/CLI contracts are in the
[API reference](api-and-elements.md).

## Host packaging

There is one canonical skill/runtime folder. Each repository catalog lists only
`brainstorm-whiteboard`, with source `./skills/brainstorm-whiteboard` resolved
from the repository/marketplace root.

| Host | Repository catalog | Manifest inside the skill folder | Skill path |
| --- | --- | --- | --- |
| Claude Code | `.claude-plugin/marketplace.json` | `.claude-plugin/plugin.json` | `./` |
| Codex | `.agents/plugins/marketplace.json` | `.codex-plugin/plugin.json` | `./.` |

Both skill paths resolve to this folder's own `SKILL.md`. Codex's legacy
resolver rejects the empty relative tail in `./`, hence the different spelling.
References, helpers, build inputs, demo media and license stay within the plugin.
There are no provider backends, MCP servers, hooks or automatic service startup.

For an existing checkout containing the catalogs, register it from its
repository root, then install `brainstorm-whiteboard@tandem-skills`:

```powershell
claude plugin marketplace add .
# Or, for Codex:
codex plugin marketplace add .
```

Claude Code also supports local loading without a marketplace:

```powershell
claude --plugin-dir "<skill-folder>"
```

For hosts without plugin support, copy the complete folder using the host's
documented standalone-skill method. An agent with local file access can instead
be asked to read `<skill-folder>\SKILL.md`; this is manual loading, not automatic
discovery. Avoid installing both forms in one host and duplicating the skill.

A source-only offline copy still needs prepared dependencies, built assets and
a suitable browser. Otherwise `npm ci` requires registry access. Generated
`node_modules`, fonts and build output are not shipped as source.

### Format authorities and qualification

Claude Code:
[manifest reference](https://code.claude.com/docs/en/plugins-reference),
[marketplaces](https://code.claude.com/docs/en/plugin-marketplaces),
[local loading](https://code.claude.com/docs/en/plugins/create.md).

Codex compatibility follows pinned official source:
[manifest/path resolution](https://github.com/openai/codex/blob/05c08d76552371400d273d4539c2a116d6340755/codex-rs/core-plugins/src/manifest.rs),
[marketplace roots/sources](https://github.com/openai/codex/blob/05c08d76552371400d273d4539c2a116d6340755/codex-rs/core-plugins/src/marketplace.rs),
[skill roots](https://github.com/openai/codex/blob/05c08d76552371400d273d4539c2a116d6340755/codex-rs/core-plugins/src/loader.rs),
[plugin commands](https://github.com/openai/codex/blob/05c08d76552371400d273d4539c2a116d6340755/codex-rs/cli/src/plugin_cmd.rs),
[marketplace commands](https://github.com/openai/codex/blob/05c08d76552371400d273d4539c2a116d6340755/codex-rs/cli/src/marketplace_cmd.rs).

Native validation, installation, discovery and live-agent use remain
unqualified. Structural package tests do not establish host activation.
Claude Code provides these additional native checks from a repository checkout:

```powershell
claude plugin validate .
claude plugin validate .\skills\brainstorm-whiteboard
```

## Release-version metadata

Root `package.json` is the single Tandem release-version source. Plugin versions
are checked copies, not a separate release channel. After an intentional root
version change, maintainers run from the repository root:

```powershell
node scripts\sync-skill-plugins.mjs
node scripts\sync-skill-plugins.mjs --check
node --test tests\skill-plugins.test.mjs
```

These are repository-only commands. Standalone `npm test` does not need the
Tandem root or its version script.

## Standalone checks

From the skill folder:

```powershell
npm run check
npm test
npm run build -- --outDir dist-test
node scripts\prove.mjs --out "<evidence-directory>"
```

Browser proofs need the same PNG/browser prerequisites as runtime setup.
Each proof starts its own isolated RAM service and closes owned service/browser
resources; it does not adopt an existing board. Output is an explicit test
export, not board persistence. No live model is invoked.

For a focused proof, build its expected output directory first:

| Coverage | Build command | Proof command |
| --- | --- | --- |
| Reset/Fit and conflicts | `npm run build -- --outDir dist-controls` | `node scripts\prove-controls.mjs --out "<evidence-directory>"` |
| Exact whole-topic snapshots | `npm run build -- --outDir dist-controls` | `node scripts\prove-snapshot.mjs --out "<evidence-directory>"` |
| Topic isolation and routing | `npm run build -- --outDir dist-topics` | `node scripts\prove-topics.mjs --out "<evidence-directory>"` |
| Native restoration and real drafts | `npm run build -- --outDir dist-native-sync` | `node scripts\prove-native-sync.mjs --out "<evidence-directory>"` |
| Native recipes, branches and UX | `npm run build -- --outDir dist-authoring` | `node scripts\prove-authoring.mjs --out "<evidence-directory>"` |

The synchronization proof distinguishes the installed native projection from
authoritative scene/version data. Untouched mounts, view-only controls and
remote updates must not publish restoration as edits; real human geometry,
stroke and ink must still produce protected drafts. Path origins and points
must remain in the same coordinate basis.

Native tests can verify bindings, stable IDs, immutable seals and preserved
data, not semantic intent or visual quality. Inspect the exact sealed PNG
according to the [visual authoring guide](visual-authoring.md); disclose when
image tools cannot perform that review.

To serve an explicit development build:

```powershell
npm run build -- --outDir dist-preview
node scripts\whiteboard.mjs serve --assets dist-preview
```

This starts a separate empty RAM board. It does not migrate or repair another
running board; restarting loses that instance's working content and seals.
