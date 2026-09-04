# Project memory

- Treat `package.json` as the single source of truth for the Tandem release version.
- Before publishing or deploying a release, bump the package version with
  `npm version patch --no-git-tag-version` or the intended minor/major increment.
- Run `npm run pack` after the bump so the displayed version, generated extension,
  and ZIP artifact all identify the same release.
- Deploy both `.github/extensions/tandem/extension.mjs` and
  `skills/tandem/SKILL.md` to the matching user-scoped installation. The
  user-scoped provider owns processing when both scopes are loaded.
