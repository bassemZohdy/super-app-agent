---
name: design-system
description: Token architecture and component specifications. Three-layer tokens (primitive, semantic, component), CSS variables, spacing and typography scales, component specs, and a checker for hardcoded values. Use for design tokens, systematic design and design-to-code handoff. Offline subset; see ../VENDORED.md.
argument-hint: "[component or token]"
license: MIT
metadata:
  author: claudekit
  version: "1.0.0"
---

# Design System

Token architecture, component specifications and systematic design. This is the offline subset vendored for this repository: it has no slide generation, no Tailwind integration and no script that reaches the network (`../VENDORED.md` lists what was left out and why).

## How this repository uses it

The tokens live in `packages/ui-tokens/src/tokens.source.json` and generate every shell's constants. Read `docs/development/design-tokens.md` first. Run `npm run check:tokens` after a UI change; it fails when a generated output drifts from the source and when a shell file gains a raw color.

## When to Use

- Design token creation
- Component state definitions
- CSS variable systems
- Spacing and typography scales
- Design-to-code handoff

## Token Architecture

Load: `references/token-architecture.md`

### Three-Layer Structure

```
Primitive (raw values)
       ↓
Semantic (purpose aliases)
       ↓
Component (component-specific)
```

**Example:**
```css
/* Primitive */
--color-blue-600: #2563EB;

/* Semantic */
--color-primary: var(--color-blue-600);

/* Component */
--button-bg: var(--color-primary);
```

## Quick Start

**Generate tokens (generic, from a JSON config):**
```bash
node .claude/skills/design-system/scripts/generate-tokens.cjs --config tokens.json -o tokens.css
```

**Validate usage (hardcoded hex and pixel values):**
```bash
node .claude/skills/design-system/scripts/validate-tokens.cjs --dir apps/shell-react/src
```

## References

| Topic | File |
|-------|------|
| Token Architecture | `references/token-architecture.md` |
| Primitive Tokens | `references/primitive-tokens.md` |
| Semantic Tokens | `references/semantic-tokens.md` |
| Component Tokens | `references/component-tokens.md` |
| Component Specs | `references/component-specs.md` |
| States & Variants | `references/states-and-variants.md` |

## Component Spec Pattern

| Property | Default | Hover | Active | Disabled |
|----------|---------|-------|--------|----------|
| Background | primary | primary-dark | primary-darker | muted |
| Text | white | white | white | muted-fg |
| Border | none | none | none | muted-border |
| Shadow | sm | md | none | none |

## Scripts

| Script | Purpose |
|--------|---------|
| `generate-tokens.cjs` | Generate CSS from a JSON token config |
| `validate-tokens.cjs` | Check for hardcoded values in code |

## Templates

| Template | Purpose |
|----------|---------|
| `design-tokens-starter.json` | Starter JSON with three-layer structure |

## Best Practices

1. Never use raw hex in components; always reference tokens
2. The semantic layer enables theme switching (light and dark)
3. Component tokens enable per-component customization
4. Use HSL format for opacity control
5. Document every token's purpose
6. Keep text roles separate from fill roles and check their contrast in both themes
