# Vendored design skills

An offline subset of two agent skills from the sibling project `agentic-super-app` (`.claude/skills/design-system` and `.claude/skills/ui-ux-pro-max`), copied on 26 October 2026 so a UI change here can use them with no network and no separate checkout. `AGENTS.md` says when to use them.

## Source revision

The source folder is not a git repository, so it has no commit to cite. Its revision is identified by file content: each file below was copied unchanged unless marked **edited**, and the SHA-256 column is the hash of the file as it is here, with line endings read as LF (git may check files out with CRLF). `services/test/p212-vendored-skills.test.ts` fails when any file differs from its recorded hash or a file is added or removed, so a change must be made together with this table. The source files' own metadata: `design-system` 1.0.0 by claudekit (license MIT in its front matter); `ui-ux-pro-max` data last generated 2026-08-13 (`data/data-provenance.json`).

## Licenses

- `design-system`: MIT, as stated in the skill's front matter. The source folder ships no separate license file.
- `ui-ux-pro-max`: the source states no license in `SKILL.md` and ships no license file. Do not redistribute this subset outside this repository until the upstream license is confirmed. `data/google-font-licenses.json` records the licenses of the Google Fonts the data refers to.

## What is left out, and why

| Left out | Reason |
| --- | --- |
| `design-system`: slide data and scripts (`data/slide-*.csv`, `generate-slide.py`, `search-slides.py`, `slide_search_core.py`, `slide-token-validator.py`), `embed-tokens.cjs`, `html-token-validator.py` | Slide and infographic generation; this repository has no slides. |
| `design-system/scripts/fetch-background.py` | Fetches images from the network. |
| `design-system/references/tailwind-integration.md` | Tailwind is not used here. |
| `ui-ux-pro-max`: 18 of the 21 stack files (everything except react, angular and flutter, including shadcn and html-tailwind) | Not the shells' stacks. |
| `ui-ux-pro-max/scripts/validate_data.py`, `scripts/tests/`, `data/phosphor-icons-upstream.json`, `data/catalog-summary.json` | They validate or refresh the full dataset and fail on a subset. |

## Edits

- `design-system/SKILL.md` is rewritten for the subset: slide, Tailwind and network sections and the omitted scripts are removed, and a section on how this repository uses it is added.
- `ui-ux-pro-max/scripts/core.py`: `STACK_CONFIG` lists only react, angular and flutter, with a comment. `search.py --stack vue` now fails with "invalid choice" and not a missing-file error.
- `ui-ux-pro-max/SKILL.md`: the stack list names only react, angular and flutter, and the stack example uses react, and the description and opening paragraph say 3 stacks, not 22.

## Use offline

```bash
python .claude/skills/ui-ux-pro-max/scripts/search.py "form validation" --domain ux
python .claude/skills/ui-ux-pro-max/scripts/search.py "list" --stack angular
python .claude/skills/ui-ux-pro-max/scripts/search.py "civic services wallet" --design-system -p Cityside
node .claude/skills/design-system/scripts/validate-tokens.cjs --dir apps/shell-react/src
PYTHONUTF8=1 python -m pytest .claude/skills/design-system/scripts/tests   # PYTHONUTF8 is needed on Windows
```

No vendored script imports a network module or makes a request; the test checks that.

## Files

| File | Status | SHA-256 |
| --- | --- | --- |
| `design-system/SKILL.md` | edited | `7122f076ec041bcb56a118cb2d6398e989f34076db48158ae26fe736eb9adc2a` |
| `design-system/references/component-specs.md` | copied | `b265d979a741dd748d4e595e6898ae430faeef4f6d13d7a634fa6241b91d2da4` |
| `design-system/references/component-tokens.md` | copied | `e27f8f5999badee425c98235eabbd2cb3ebe2a1a364766d5c7a6b3134ceaaec8` |
| `design-system/references/primitive-tokens.md` | copied | `91e6caa12646c08c8aadf8e09399aed65760a25c8d80595936d81a9131118fc3` |
| `design-system/references/semantic-tokens.md` | copied | `97e16d8061bbc22e82b51966a7015e3fc990932902e4647843506669a1cdebcc` |
| `design-system/references/states-and-variants.md` | copied | `8dacb95d57d4bb37d8a99cc55515ff26da272056f837d29abc74aedcaa3ba104` |
| `design-system/references/token-architecture.md` | copied | `925f4049c4c4313d9fd5df98cdfd52004112aca49fba1664ad85e76bc9dce4d3` |
| `design-system/scripts/generate-tokens.cjs` | copied | `aac8a0f4ec4dccf0d371f9ee5a9111e44977bb0cad7e40a3754aba5571aa1231` |
| `design-system/scripts/tests/test_validate_tokens.py` | copied | `a32f34a9e89542a341b6ff3ee4392494b48dea622b22b99652d3cf0c1a1ee966` |
| `design-system/scripts/validate-tokens.cjs` | copied | `65f03a29290b9029d8cc27537701f226de7bcffc303b3bc361648fadfa09b77d` |
| `design-system/templates/design-tokens-starter.json` | copied | `5444f477b06bab9c72e2cc289d4a9104efef653391c9639972bcb712d5f2d81e` |
| `ui-ux-pro-max/SKILL.md` | edited | `9964396786b07421306e97c5fcbb3f62462dc4fda5c7961349c4bbeaedb09d07` |
| `ui-ux-pro-max/data/app-interface.csv` | copied | `331e7cf2c0b222d80c566c5f255c63cb339f65bfd02e471a720f28e4864a9f08` |
| `ui-ux-pro-max/data/charts.csv` | copied | `4115cf1120680f2cedef0676cb648f30c7ef4699e2a947535d4113e71ed3b12a` |
| `ui-ux-pro-max/data/colors.csv` | copied | `8162429222bce22df62b564085946a30d07cc9722c58d0a3a494bd0d1d00841c` |
| `ui-ux-pro-max/data/data-provenance.json` | copied | `e82fb33ed49375a300e93d9c11ccd1c1493c999e84ee7ee295e527634786e2e0` |
| `ui-ux-pro-max/data/google-font-licenses.json` | copied | `35688523f2955795caa1a47c53b83099e60c1708461476f9cc3a050cf3b0148a` |
| `ui-ux-pro-max/data/google-fonts.csv` | copied | `1c8c3b2ea1faf6a1012da463756def8b3889db33f2226f0343bb4daa80307d03` |
| `ui-ux-pro-max/data/icons.csv` | copied | `50816c6012030178195a16ee481ebf58b47bd985d70e8ec58886cc83f6eddafc` |
| `ui-ux-pro-max/data/landing.csv` | copied | `9a2edd3bb676c2a58f00ade7a062e285222d4297bfd847c8d5b056f0dbbf52d0` |
| `ui-ux-pro-max/data/motion.csv` | copied | `381affe8df8ea1f66fbbda2598827f9f54299107bbe6a1b4e9b68f6b62091ceb` |
| `ui-ux-pro-max/data/products.csv` | copied | `42473f75e8dde5987bdf89ce55d8c168091b80a356cae691dd60247d80720b70` |
| `ui-ux-pro-max/data/react-performance.csv` | copied | `3d925802539abac5afeb63ae8aa1960b7229ad271b3a47caed40ab2d97ad0734` |
| `ui-ux-pro-max/data/stacks/angular.csv` | copied | `704be83f2bad30c7e6de01afb113ffa01e0c458762f48b7102f31ba2367b5553` |
| `ui-ux-pro-max/data/stacks/flutter.csv` | copied | `64dba0ac17349f28bce517a0f5f48c54d9ed2e487ec0c0258303463b382f41a0` |
| `ui-ux-pro-max/data/stacks/react.csv` | copied | `2d2b9c198e875106a30f7ee68341a9ee0033cad60a7e130cf23152783e08aeda` |
| `ui-ux-pro-max/data/styles.csv` | copied | `a93a4d9d7025856575d7b7583bda020be9043013432c5af7c58af9dbdfb206b7` |
| `ui-ux-pro-max/data/typography.csv` | copied | `321fc446e89024488ebae96dda93efc4d2307bd8bddb240857ad51364f6782c8` |
| `ui-ux-pro-max/data/ui-reasoning.csv` | copied | `f0774dd741cecdad5eec842034bd6d5e9ea50e9f220a1910069748daa0bb8e9a` |
| `ui-ux-pro-max/data/ux-guidelines.csv` | copied | `ff81ec613f70ba9fc3fcce52dbe4ae35d44b2079dbe6dc066d2d6e38c28facd5` |
| `ui-ux-pro-max/scripts/core.py` | edited | `086b23819e922d418e54f235c93e60a680a9948e12de57cd0719a94e84f74b83` |
| `ui-ux-pro-max/scripts/design_system.py` | copied | `6a94743c3362c9c7e6d1450b94f4014d9ea752e7b4e151f6f0bdb217e0544bf7` |
| `ui-ux-pro-max/scripts/reasoning_contract.py` | copied | `b8bac1af82aa280d3e06f00aabaeac4337e632996b07fed874e2b6ee6e9c5913` |
| `ui-ux-pro-max/scripts/search.py` | copied | `8373e2dd2d560d9853ec116140de0e0d5bee45a6abe5e041173c84e1c36a7f87` |
