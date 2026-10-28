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
| `apps/shell-flutter/lib/theme/tokens.g.dart` | Flutter: `CitysideTokens` colors (light and `dark…`), spacing and radii. Compiled by Flutter analysis, widget tests and the separate web build. |

Do not edit these three files; change the source.

## Raw colors in shells

Shell source should use these tokens, not its own hex, rgb or hsl values or Flutter `Color(0x…)` and `Colors.*` literals. No shell has a raw color and the baseline is empty. Flutter uses `CitysideTokens.primitive…` constants; source checks and the separate Dart analyzer/widget suite verify these references. Colors that were hand-picked per screen were clustered to the nearest of 84 primitive tokens (a distance of at most 4 in CIELAB, so a change is visible only side by side); a shadow takes its token through `color-mix(… transparent)`. `npm run check:tokens` fails when a file gains a raw color or a new file has one, and also when a file loses some without the baseline being lowered; after migrating a file run `npm run colors:baseline` and commit the smaller baseline. The baseline is empty when the shells are migrated.

## React workspace design

The concierge opens as a chat workspace with an assistant greeting, message bubbles and a labelled composer anchored inside the viewport. The dark navigation rail explicitly names **Chat with Rashid**. From 680px on a continuous main-concierge screen, conversation and service details begin at 50/50 with a draggable divider. Below that width, **Chat** and **Service details** select a single view; the focused fines workspace keeps its stacked phone layout below 800px. Replies update service details without taking the resident away from the conversation. Switching views preserves the transcript and draft. New conversations and the chat navigation action return to the chat. Pane headers expose an icon-only **Swap panes** action and a **Maximize** icon that becomes **Restore** for that pane. There is no layout menu, separate restore control or minimize mode. The navigation becomes a drawer at 1100px, leaving tablets room for both panes. Resize with mouse or touch, or focus the separator and use Left/Right (Shift for larger steps), Home/End for the usable bounds and Enter to reset to 50/50. Double-click also resets. Swapping retains each pane's width share and maximizing/restoring preserves the split and drafts.

On browsers exposing viewport segments, unfolded book screens place one pane in each segment with the hinge as a non-interactive spacer; clamshell screens place conversation above the fold and details below it. The navigation stays in a drawer and maximized content stays within one segment. A physical hinge determines the split, so dragging is unavailable in that mode. Other browsers retain the width-based layout. These progressive rules use [viewport-segment media queries and environment variables](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/horizontal-viewport-segments).

The palette comes from shared tokens: navy `#131b2e` for navigation, slate `#e2e8f0`/`#94a3b8` for its text, teal `#285c76` for primary actions and user bubbles, white `#ffffff` for chat/review panels, and slate `#f8fafc` for the workspace and assistant bubbles. Avenir Next with system fallbacks supplies all type without a font download. Greeting, transcript and suggestions have distinct roles; compact prompt chips replace the large welcome cards. The empty service view explains where results will appear. No external image or font is loaded.

Keep the outer chat workspace within `100dvh`, with shrinkable flex ancestors and a scrolling transcript. The composer and its visible **Send** action stay in view after long replies and on a short phone viewport; service details scroll independently. The dark drawer keeps keyboard focus inside, closes with Escape and restores its opener. A skip link reaches the workspace. The message field's container supplies the focus outline. Payment controls use separate fill and text roles.

The design checklist covers accessible token pairs, visible labels and focus, 44px touch targets, loading/disabled feedback, navigation, wrapping at 320/390/768/1024/1280/1440/1920px and reduced motion. Run `npm run check:tokens` and `npm run test:browser`; focused-agent journeys measure actual composer visibility before/after sending and resizing, a long scrolling reply, draft preservation, returning to chat, icon-only controls, maximize/restore through the same button, equal default widths, mouse/touch/keyboard resizing, and width/overflow checks through large desktop sizes. Chromium device emulation checks both book and clamshell hinges, composer clearance and returning to a continuous phone view; physical foldable devices remain unqualified. The service-navigation suite uses real local sign-in and APIs to prepare and reload every sidebar service without asking a model. Only the focused-agent suite's main concierge layout check uses an explicitly stubbed gateway; fines use the real isolated agent/SQLite runtime. Native/device and real-model qualification remain separate boundaries.

## Design skills for agents

Two agent skills are vendored offline in `.claude/skills/`: `design-system` (token architecture and a hardcoded-value checker) and `ui-ux-pro-max` (searchable accessibility, touch, forms and navigation guidance, with React, Angular and Flutter stack data). `AGENTS.md` says a UI change uses them. What was left out, the three edits, the license status and a hash of every file are in [`.claude/skills/VENDORED.md`](../../.claude/skills/VENDORED.md); `services/test/p212-vendored-skills.test.ts` fails if a file drifts from its hash, if a vendored script could reach the network, or if an omitted part comes back. On Windows run the vendored Python tests with `PYTHONUTF8=1`. `frontend-design` is not vendored: it is a broken link in the source, so use the account-level skill.

Angular and Flutter use the same equal split, bounded resize, swap and maximize/restore interaction contract. Phone switching retains drafts; a new approval reveals service details. Flutter widget tests cover book/clamshell display features, resize and draft retention. Flutter bundles Roboto and Noto Naskh Arabic with their upstream licenses; `npm run build:flutter` also replaces the engine's remote font fallback with a local asset path. No runtime font download is required.

In a single-pane phone workspace, the swap icon changes the visible view and remains available to switch back; the selected Chat or Service details control is visibly highlighted and exposes its selected state. On a split display the icon continues to exchange pane positions. The React focused fines workspace keeps its stacked phone layout and scrolls to the pane moved to the top. View changes are immediate and do not require animation.

The Flutter workspace divider and pane action buttons use 48px targets derived from the shared spacing scale. The divider exposes increase/decrease semantics, Left/Right steps, Shift for larger steps, Home/End bounds and Enter reset. A 3px focus border uses the theme-appropriate focus token and appears without animation, including when reduced motion is requested. Widget and web checks cover the pane controls; other Flutter panels remain separate.

Flutter web links its generated divider slider to the labeled semantics container with `aria-labelledby`. The link follows label changes and is recreated when layouts rebuild, while any name supplied by the engine takes precedence. Browser checks verify the computed slider name, target size, value and keyboard operation; physical screen-reader testing remains separate.

The focused fines sign-in form uses token-based 48px action targets and a theme-aware input focus border. Its content scrolls on short screens at large text sizes, keeping both sign-in actions reachable. Widget checks cover keyboard focus, dark mode, reduced motion and large text; web checks measure the exposed controls.
