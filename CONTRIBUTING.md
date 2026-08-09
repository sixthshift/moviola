# Contributing

## Setup

```sh
bun install
bunx playwright install chromium   # once, for the e2e suite + validator
```

Bun is the package manager and script runner; Node ≥ 20.11 runs the build and
validator scripts. (The devcontainer under `.devcontainer/` ships both, with
Playwright's browser baked in.)

## Scripts

| Command | What it does |
|---|---|
| `bun run dev` | Vite dev server over the repo (open `/index.html` or `/examples/…`) |
| `bun run build` | `src/*.ts` → `dist/` (iife, min, esm, d.ts, css) + re-sync all embeds |
| `bun run test` | Vitest unit suite (`test/unit/`) — fast, no browser |
| `bun run test:e2e` | Fresh build, then Playwright suite (`e2e/`) in real Chromium |
| `bun run typecheck` | `tsc --noEmit` (strict) |
| `bun run lint` / `format` | Biome check / write |
| `bun run check-links` | Verify relative links in README/SPEC/docs resolve |
| `bun run check` | All of the above **plus** a dist-freshness gate |

`node scripts/validate-story.mjs <page.html> [--tier1]` runs the SPEC §14
story validator against any moviola page.

## The rules that matter here

1. **Never hand-edit `dist/`, the examples' lib blocks, or `skill/assets/`.**
   They are generated. Change `src/`, run `bun run build`, and commit the
   regenerated files together with your source change — `bun run check`
   fails on any drift.
2. **Author glue in examples/fixtures stays outside the
   `<!-- moviola:js/css -->` markers.** Everything inside them is replaced
   by the build and treated as "the lib" by the validator.
3. **Respect the invariants** listed in
   [ARCHITECTURE.md](ARCHITECTURE.md#invariants-do-not-break) — no-JS
   readability, size budgets, structural-CSS-only, no scroll-jacking. The
   test suite enforces all four; SPEC changes need a spec edit in the same
   change.
4. **Public API changes** (SPEC §7) need: SPEC edit + unit + e2e coverage +
   a README example if the surface is author-facing.

## Before you push

```sh
bun run check
```

Green means: types, lint, 65+ unit tests, the Playwright suite (including
the validator's 10 adversarial fixtures), doc links, and byte-fresh
dist/embeds.
