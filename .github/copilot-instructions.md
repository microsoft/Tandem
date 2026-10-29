# Project memory

- Treat `package.json` as the single source of truth for the Tandem release version.
- Before publishing or deploying a release, bump the package version with
  `npm version patch --no-git-tag-version` or the intended minor/major increment.
- Run `npm run pack` after the bump so the displayed version, generated extension,
  and ZIP artifact all identify the same release.
- Deploy both `.github/extensions/tandem/extension.mjs` and
  `skills/tandem/SKILL.md` to the matching user-scoped installation. The
  user-scoped provider owns processing when both scopes are loaded.

## Implementation boundaries

- Edit maintainable TypeScript and renderer assets under `src/`, not the generated
  extension. Use `npm run check`, `npm test`, and `npm run build`.
- Keep process-block integrations behind `ProcessAdapterRegistry`. Local and
  GitHub selections must preserve artifact and receipt history; never silently
  substitute adapters after an error.
- Operational state belongs in ignored `.tandem`; accepted exports belong in
  `tandem-records` only after an explicit export. Export is not Git publication.
- Worker-reported completion is not tool-backed evidence. Preserve source,
  request, and specification identities when recording or reusing a pass.
- Use `src/planning-prompts.ts` for production and behavioral evaluations rather
  than maintaining separate prompt copies. Live evaluations require explicit
  model and execution limits.
