# Design tokens

One source, `packages/ui-tokens/src/tokens.source.json`, feeds the React, Angular and Flutter shells. Edit it, run `npm run tokens:generate`, and commit the outputs. `npm run check:tokens` (part of `npm run check`) regenerates them in memory and fails if a committed output differs, so a hand edit to a generated file is caught.

## Layers

| Layer | Holds | Rule |
| --- | --- | --- |
| Primitive | the palette and the scales: font, size, weight, space, radius, shadow, breakpoint | the only place a color value is written, as lowercase `#rrggbb` |
| Semantic | roles such as `primary`, `surface`, `text`, in a `light` set and a `dark` set of overrides | each role references a primitive, never repeats a value; a dark role needs a light role |
| Component | `button`, `card`, `input` | each token references a semantic role or a primitive |

A reference is written `{primitive.color.teal-700}` or `{semantic.primary}`. A missing path or a cycle fails the build. In CSS a component token that references a role is emitted as `var(--color-…)`, so it follows `[data-theme='dark']` without a second definition.

## Text roles, contrast and focus

A fill and a text color are separate roles. `success`, `warning` and `danger` are fills (badges, bars, icons) and measured 3.45:1, 2.15:1 and 3.76:1 on white, so text uses `successText`, `warningText` and `dangerText`, and `primaryText` for links; each has a separate dark value, because a light-theme text color is unreadable on a dark surface (the primary fill as dark-theme text was 2.4 to 2.7:1). The source lists the text/background pairs that must meet a minimum ratio in a `contrast` array (4.5:1 for text, 3:1 for the focus ring), written as token references. `npm run tokens:generate` evaluates every pair in both themes and refuses to write outputs if one fails, with the pair, theme and ratio in the message. `--color-focus-ring` is the focus indicator color and `--font-size-control` (14px) is the smallest text size for a control.

## Outputs

| File | Used by |
| --- | --- |
| `packages/ui-tokens/src/theme.css` | React and Angular. Keeps every variable the shells already used (`--color-primary`, `--spacing-small`, …) with the same values, and adds `--primitive-color-*` and component variables such as `--button-background`. |
| `packages/ui-tokens/src/tokens.json` | the `UI_TOKENS` import. Keeps its original keys and adds `colorsDark` and `components`. |
| `packages/ui-tokens/src/a11y.css` | Hand-written, not generated. The shared reduced-motion rule, loaded as a global stylesheet by React (`@import` in `index.css`) and Angular (`angular.json` `styles`, with `theme.css`). It must be global: Angular's component-scoped `*` rule never reaches `html`, `body` or the app host. |
| `apps/shell-flutter/lib/theme/tokens.g.dart` | Flutter: `CitysideTokens` colors (light and `dark…`), spacing and radii. It is generated text and is not compiled by any check here because there is no Dart toolchain in this environment. |

Do not edit these three files; change the source.

## Raw colors in shells

Shell source should use these tokens, not its own hex, rgb or hsl values or Flutter `Color(0x…)` and `Colors.*` literals. Today's raw colors are recorded per file in `packages/ui-tokens/raw-colors.baseline.json`. `npm run check:tokens` fails when a file gains a raw color or a new file has one, and also when a file loses some without the baseline being lowered; after migrating a file run `npm run colors:baseline` and commit the smaller baseline. The baseline is empty when the shells are migrated.

## React workspace design

The React shell uses a civic service-desk layout: left-aligned conversation and a separate service directory/review. The conversation gets more desktop space; swapping panes also swaps their width roles. On phones and tablets up to 800px, the panes stack in reading order and navigation becomes a drawer. The drawer keeps keyboard focus inside, closes with Escape and returns focus to its opener. A skip link reaches the workspace. The message field has a visible label and its container supplies the focus outline.

The palette comes from existing tokens: teal `#285c76` for primary actions, white `#ffffff` for the workspace, slate `#f8fafc` for supporting surfaces, navy `#0f172a` for body text and slate `#64748b` for helper text. Amber and sage text roles distinguish utility and housing icons; labels also identify each service. Avenir Next with system fallbacks supplies all type without a font download. Use the spacing and type scales for hierarchy, 44px minimum controls, and larger headings only for the current task. The small local CSS skyline connects the directory to Dubai without an image request.

The main welcome offers one direct fines link and familiar everyday tasks. The directory stays subordinate to the conversation; exact amounts and confirmation remain in service details. Avoid invented balances, activity counts or readiness claims. This direction replaces repeated promotional headings with a task-led welcome and a compact service list. The main React stylesheet uses shared color roles throughout; the renderer and other shells retain their separate raw-color migration boundary.

The design checklist covers accessible token pairs, visible labels and focus, touch targets, loading/disabled feedback, predictable navigation, wrapping at 320/390/768/1024/1440px and reduced motion via the shared stylesheet. Run `npm run check:tokens` and `npm run test:browser`; the focused-agent suite measures layout and drawer behavior with a clearly stubbed concierge gateway and real isolated fines runtime. The stack accessibility suite measures retained account/delegation screens. These checks do not establish native/device or complete Arabic/RTL parity.

## Design skills for agents

Two agent skills are vendored offline in `.claude/skills/`: `design-system` (token architecture and a hardcoded-value checker) and `ui-ux-pro-max` (searchable accessibility, touch, forms and navigation guidance, with React, Angular and Flutter stack data). `AGENTS.md` says a UI change uses them. What was left out, the three edits, the license status and a hash of every file are in [`.claude/skills/VENDORED.md`](../../.claude/skills/VENDORED.md); `services/test/p212-vendored-skills.test.ts` fails if a file drifts from its hash, if a vendored script could reach the network, or if an omitted part comes back. On Windows run the vendored Python tests with `PYTHONUTF8=1`. `frontend-design` is not vendored: it is a broken link in the source, so use the account-level skill.
