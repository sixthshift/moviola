# Architecture

moviola is a scroll-position → DOM-state compiler. The runtime never touches
a visual property: it converts scroll geometry into declarative state
(classes, one attribute, two CSS custom properties) and lets author CSS do
every effect. This document covers how the repo implements that; the
normative contract lives in [SPEC.md](SPEC.md).

## Module map (`src/`)

```
index.ts      public API — Moviola.init(), version; the only entry point
story.ts      Story class: lifecycle, engage/disengage, §5–§7 state writes
motion.ts     Motion class: §15 motion writes — scrub --t, camera, morph wrap
camera.ts     §15.3 shot resolution: SVG measurement; shared warnOnce
geometry.ts   pure math: activeIndex, stepProgress, storyProgress, clamp
keyboard.ts   ←/→ chapter stepping (guards first, never scroll-jacking)
events.ts     bubbling CustomEvent emit + typed subscribe
types.ts      public type surface (StepDetail, MoviolaEventMap, …)
moviola.css   structural layer only: pinning, layouts, mobile collapse
```

Dependencies point one way: `index → story → motion → {camera, geometry}`,
with `story` also over `{geometry, events, keyboard, types}`.
`geometry.ts` is deliberately DOM-free — it is the state machine's math,
unit-tested as pure numbers against the SPEC §5 semantics.

The core/motion seam is executed, not pending. `story.ts` owns **§5–§7
emission**: the IntersectionObserver engage/tick loop, `activeIndex`, the
`is-past`/`is-active`/`is-future` classes, `data-active-step`, the progress
variables (`--story-progress`, `--step-progress`, `--progress-<id>`),
`data-show` → `is-shown`, and the three events. `motion.ts` owns **§15
emission**: the `[data-scrub]` `--t` stamps, the cached camera shots and
`--camera-transform`, and the `data-morph` view-transition wrap — one `Motion`
per `Story`, constructed by it and torn down with it.

The core hands motion exactly five moments — construction, each frame, each
step change, each resize, teardown — and never learns whether a camera or a
scrub exists; motion never reads back into the story. So `data-morph` wraps
only the §5.2 atomic write batch (the core passes that closure in), while the
progress-variable writes stay outside it.

## Dataflow

```
scroll/resize event                      (only while the story intersects
        │                                 the viewport — an IntersectionObserver
        ▼                                 gates the listeners per story)
rAF throttle (_tick)
        │
        ▼
_update(): measure getBoundingClientRect → geometry.ts →
        │
        ├─ class writes        .is-past / .is-active / .is-future
        ├─ attribute write     [data-active-step="id"]
        ├─ graphic visibility  [data-show] → .is-shown
        ├─ CSS variables       --step-progress, --story-progress
        └─ events              moviola:stepexit → moviola:stepenter → moviola:progress
                               (exit before enter; plain bubbling CustomEvents)
        ▼
author CSS reacts (transitions, crossfades, anything)
```

## Invariants (do not break)

1. **`is-ready` is stamped last** in the Story constructor, and all hiding
   CSS is scoped under `.moviola.is-ready`. A page whose JS never runs stays
   fully readable (SPEC §8.1).
2. **Zero runtime dependencies** and the SPEC §3 size budgets: ≤ 4608 B gzip
   JS (4.5 KiB — raised from 4096 B by change order CO-1 in v0.5, SPEC §16.5),
   ≤ 2048 B gzip CSS — enforced by `test/unit/size.test.ts` on `dist/`.
3. **Structural CSS only** in `moviola.css`: geometry and visibility
   mechanics, never typography/color (themes own those; enforced by
   `test/unit/themes.test.ts`).
4. **The browser owns scrolling.** moviola observes; keyboard stepping is an
   enhancement that never intercepts vertical scroll keys.

## The embed chain

The consumer contract is a classic script from `file://`, so `dist/` is
generated **and committed**, and several places embed the library outright:

```
src/*.ts ──bun run build──▶ dist/moviola.min.js   (canonical artifact)
                                  │
                 scripts/sync-embeds.mjs (runs inside the build)
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
examples/*.html          e2e/fixtures-*/*.html       skill/assets/
(between <!-- moviola:js/css --> marker pairs)       (file copies)
```

`test/unit/embeds.test.ts` asserts every embedded copy is byte-identical to
dist, and `bun run check` ends with `git diff --exit-code dist examples
skill/assets` so a stale build can't slip through. The §14 validator
(`scripts/validate-story.mjs`) identifies "the lib" inside any page by
byte-equality with `dist/moviola.min.js` — that is what makes its glue-tier
classification (author JS vs library JS) trustworthy without any name
matching. Author glue must stay **outside** the markers.

## Build pipeline

The build is exactly `vite build`. `vite.config.ts` declares lib mode (esm +
bundled `moviola.d.ts` via `vite-plugin-dts`, plus an iife format built only
as an in-memory intermediate — never written to `dist`) plus a small
`moviola:artifacts` plugin that emits the rest: `moviola.min.js` (an esbuild
pass over that iife intermediate, mangling only `_`-prefixed internals —
never the public contract; this is the canonical runtime artifact, and the
readable implementation reference is `src/`), `moviola.css` (copied verbatim;
the CSS is deliberately not JS-imported), and — in `closeBundle` — the embed
re-sync via `scripts/sync-embeds.mjs`. The build is deterministic — no
dates, no hashes — because embeds are compared byte-for-byte.

## Test tiers

- **`test/unit/` (Vitest, milliseconds)** — geometry as pure math; the Story
  state machine and keyboard guards under happy-dom with stubbed
  IntersectionObserver/rects; static scans (themes, sizes, embeds, package
  manifest).
- **`e2e/` (Playwright, real Chromium)** — the SPEC driven by real scrolling
  against hand-tuned fixture geometry (`e2e/fixture.html`, trigger math is
  exact); keyboard smooth-scroll; theme swaps over `index.html`; both dist
  builds; and the story validator exercised against every broken fixture.
- **`scripts/validate-story.mjs` (SPEC §14 as a CLI)** — drives any moviola
  page forward/reverse/out-of-order in a real browser with runtime
  instrumentation and network interception, screenshots each step, and
  classifies stories tier1/tier2/fail. `--tier1` enforces the zero-glue bar.
