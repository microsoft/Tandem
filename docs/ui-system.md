# Tandem UI system

[Engineering reference](engineering-reference.md) | [Contributing](../README.md#development-and-contributions)

Tandem combines **Radix UI interaction primitives**, **shared visual tokens** and
a small **Tandem component layer**. Storybook is the development catalogue for
that layer, not another application or a replacement UI framework.

## Open the catalogue

After installing the repository dependencies with its approved npm registry:

```powershell
npm run storybook
```

Open `http://127.0.0.1:6006`. The server is loopback-only, does not open a browser
automatically, and fails rather than choosing another port if 6006 is occupied.
Use the theme toolbar for light/dark previews, Controls for supported properties,
and Accessibility to inspect a rendered example. Stop the server with Ctrl+C.

```powershell
npm run build:storybook
```

The static catalogue is written to ignored `dist\storybook`. Neither command
starts Copilot, opens a project, deploys an extension, or publishes anything.
Storybook telemetry is disabled. Stories use synthetic data and must not fetch
private project state or invoke runtime APIs.

Storybook uses its own Vite builder. The application's esbuild pipeline is
unchanged; Storybook, Vite and the addons are development dependencies.

## Foundations

The shared source is
[`project-theme.css`](../development/tandem/public/project-theme.css).
The main renderer, browser shell and embedded Development use its semantic
tokens. Keep the existing palette, compact density and host theme integration.

| Foundation | Tokens and guidance |
| --- | --- |
| Colors | `--studio-surface`, `--studio-text`, `--studio-muted`, `--studio-accent`, and semantic success/warning/danger colors |
| Filled actions | `--studio-action-bg` / `--studio-danger-action-bg` with `--studio-on-action` and `--studio-action-border`; do not use a light dark-mode status color as a filled button background |
| Typography | `--studio-font-family`, `--studio-font-mono`, `--studio-text-small`, `--studio-text-title`, `--studio-font-weight-semibold` |
| Spacing | `--studio-space-1/2/3/4/5/6/8`: 4, 8, 12, 16, 20, 24 and 32px |
| Density | 30px default controls; explicit 26px small and 36px large variants; at least 44px for touch pointers. Native question forms retain their readable 44px targets. |
| Shape and elevation | `--studio-radius-control`, `--studio-radius`, `--studio-radius-dialog`, `--studio-shadow`, `--studio-shadow-dialog` |
| Focus and motion | Shared focus width/color/offset; visible keyboard focus; reduced-motion and forced-color support |

Existing density tokens remain compatible. Do not replace application typography
or host theme values with a separate Storybook-only theme. Portaled dialogs must
inherit the same theme as the page. Embedded surfaces use the compact 13px text
scale; standalone Development retains its readable 14px scale and existing
text-size preferences. Both scales are tokenized, not per-component overrides.
Control borders have their own contrast-aware `--studio-control-border`; subtle
panel borders are not a substitute for input boundaries. Semantic colors derive
from the actual text/surface pair when the host supplies no semantic color,
including when the host palette and operating-system theme differ.

## Shared components

Import from [`src/renderer/ui/index.tsx`](../src/renderer/ui/index.tsx). Production
entrypoints already load the shared styles through `src\renderer\styles.css`;
Storybook imports the same theme and component stylesheet directly.

| Component | Contract |
| --- | --- |
| `Button` | `primary`, `secondary`, `danger`, `ghost`, `item`; `small`, `medium`, `large`. Defaults to `type="button"`. `item` is for navigation rows, not a second primary action. `loading` prevents repeat activation, exposes `aria-busy`, and retains the visible label. Native attributes, handlers and refs remain available. |
| `IconButton` | Button behavior with a required `aria-label` and a square target. Mark the icon `aria-hidden`; use `aria-pressed` for toggles or `aria-expanded` and `aria-controls` for disclosures. |
| `ActionLink` | Button appearance on a real anchor; preserves URL, target, rel and native link behavior. Use `iconOnly` only with an accessible name. |
| `Input`, `Textarea`, `Select` | Styled native controls with forwarded refs and unchanged native attributes/events. Radio/checkbox inputs keep their native appearance and sizing, not text-field dimensions. |
| `FormField` | Visible label, stable control ID, description/error IDs and `aria-invalid`. Spread the supplied attributes onto the actual input, textarea or select. The caller owns values, validation, required/disabled state and submission. |
| `Dialog` | Controlled Radix dialog with required title/description, shared overlay and optional footer/trigger. Retains content event handlers. A trigger restores focus automatically; external triggers can retain `onCloseAutoFocus`. |
| `DialogParts`, `AlertDialog` | Styled composable Radix families for existing complex dialogs and consequential confirmations. Keep their original dismissal, initial focus and focus-return rules. |
| `NativeDialog` | Shared appearance on a native `dialog`, with a forwarded `HTMLDialogElement` ref. The caller still owns `showModal`, `close`, cancellation and recovery. |
| `Disclosure` | Native `details`/`summary` behavior, forwarded ref and shared summary typography/focus. Keep the existing `open` and `onToggle` contracts; Radix collapsibles compose their trigger with a shared `Button` through `asChild`. |
| `Tabs` | Styled Radix family, including `List` and `Trigger`. Use `Tabs.Bar` around substage lists for the shared flat surface, bottom divider and action spacing. Put preview actions beside the list, not inside its keyboard navigation. Selection indicators, focus and horizontal overflow belong to the shared stylesheet. |
| `ToggleGroup`, `RadioGroup`, `Tooltip` | Styled Radix families preserving native Radix keyboard and controlled-state behavior. Radio items support circular controls or `presentation="choice"` cards; icon toggles declare `iconOnly`. |
| `Status` | Meaningful text plus a decorative semantic icon. `busy` adds a reduced-motion-aware spinner. No live region by default; explicitly use `role="status"` for updates or `role="alert"` for urgent errors. |

```tsx
<FormField id="project-name" label="Project name"
  description="Use a short, recognizable name." error={nameError}>
  {control => <Input {...control} value={name}
    onChange={event => setName(event.target.value)} />}
</FormField>
<Button type="submit" variant="primary" loading={saving}>
  {saving ? "Saving changes..." : "Save changes"}
</Button>
```

Keep one main action per decision. Prefer an existing variant to a new CSS
override. Keep layout-specific classes on the surrounding feature when possible;
add shared variants only for recurring needs. Controls must remain understandable
with long labels, narrow layouts, keyboard navigation and non-color status cues.

Do not substitute `Dialog` for consequential `AlertDialog` confirmations or
replace native dialogs with custom permission/recovery behavior just to share
markup. UI primitives do not own workflow state, request admission, evidence,
authorization or native runtime lifecycles.

## Application-wide adoption

All active React renderer panels and browser chrome use the shared button,
input, select, textarea, dialog and styled Radix families. The catalogue includes
navigation, choices, tooltips, confirmations and side-by-side React/native
surface examples, in addition to individual component states.

The framework-neutral control stylesheet lives in
`development\tandem\public\ui-system.css`, beside the shared tokens, so the
independently packaged Development renderer can load it without importing React.
`src\renderer\ui\styles.css` imports that same source. Development loads
`application.css`, which composes its existing styles and the shared controls;
`ui-native.css` maps its existing semantic actions to the shared visual tokens.
No runtime action, permission decision or request identity is inferred from text.

The styles use ordered cascade layers: **tandem-legacy**, **tandem-ui**, then
**tandem-layout**. Existing feature rules retain layout and history-specific
presentation, but cannot override shared control appearance by selector
specificity. `src\renderer\ui\layout.css` preserves intentional layout differences
such as navigation rows, compact graph toolbars, composer expansion, selected
tree items, dialog sizes and context-dependent visibility. Keep such exceptions
explicit and avoid new blanket overrides or `!important`.

Development retains its renderer, readable question cards, native dialogs and
independent workflow. Generated UI DSL views, user-authored artifact contents,
prototype iframes and vendored renderers are not restyled.

When adding or migrating a control:

1. Reuse the shared component and semantic tokens; preserve IDs, accessible names,
   event handlers, disabled rules and focus restoration.
2. Add or update colocated `*.stories.tsx` examples for relevant variants, themes,
   loading/disabled/error states and long content.
3. Keep interaction examples local. Add focused regression coverage for behavior
   that could affect forms, accessibility or existing workflows.

`npm run check` includes stories and Storybook configuration. `npm test` includes
component regression coverage and, when the existing Edge fixture is available,
rendered contrast, keyboard focus, portal themes, reduced motion and touch sizes.
`tests\ui-consistency.test.ts` enforces shared-control adoption and compares
computed control styles across React, browser, Storybook and native Development
in both themes and at wide/narrow widths. Browser fixtures must bundle CSS imports using
the existing esbuild setup, rather than stripping imports or concatenating only
one stylesheet.
The navigation checks also compare real Requirements and Prototype panels,
including their surrounding bars, spacing and preview actions. Catalogue/feature
comparisons include active, inactive and disabled tabs and their pseudo-elements,
so a legacy underline or a locally styled container cannot pass just because the
buttons use the shared component.

For a focused consistency audit, run:

```powershell
node --import tsx --test tests\ui-consistency.test.ts
```

When a mismatch appears, identify the equivalent component/state, inspect its
container and `::before`/`::after` styles as well as the control, then move the
common appearance into the shared family and add the affected production surface
to the comparison. Keep genuine layout differences, such as the project sidebar,
explicit in `tandem-layout`; do not flatten them into horizontal sub-tabs. The
**Substage navigation** story covers completion, building, failure, locked items
and long labels. These checks use synthetic local fixtures, not live project work.

Use `npm run build` and `npm run build:storybook` to verify the independent
production and catalogue builds.

The Accessibility panel and example interactions support review; they are not
accessibility certification or a hosted visual-regression service. No external
snapshot service or automatic publication is configured.
