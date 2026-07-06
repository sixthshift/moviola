# Oracle — scrolly (v1 drive)

The definition of done for driving `SPEC.md` to v1.0's **machine-checkable
subset**. Written at intake (2026-07-06) on a brownfield tree: v0.1 core
(lib, structural CSS, demo, 14-test harness, recipes, SKILL.md, keyboard
stepping) already exists and passed the baseline at intake — treated as a
verified builder claim, evidence in ledger [0002].

Frozen means never *silently* changed. Mechanical fixes self-serve with a
ledger entry; semantic changes escalate. Escaped-bug rule applies.

## Scope of this drive vs. human gates

This loop drives ONLY what is machine-checkable. **Explicitly outside the
loop** (human gates — never build around them, never mechanize them):
- The project **name** (npm `scrolly` is taken) and npm publish.
- The browser **feel-pass** (Chrome/Safari/Firefox, <720px) — Jason's eyes.
- **Parity judgment** (SPEC §14 rubric "indistinguishable in kind") and the
  SKILL cold-test *quality* judgment.
- **Gallery publish-worthiness**: every example ticket has mechanical floors
  (min words, no duplicate sentences, screenshot-distinct states) but
  narrative/visual quality is irreducibly human — each example gets Jason's
  glance before the gallery is treated as marketing (red-team finding,
  ledger [0004]).
- The `full`-layout and a11y-`inert` decisions (SPEC ❓ items, proposals
  pending with Jason).

## Locked decisions (never re-litigated — cite in every worker prompt)

- **Simple lib. No AST, no parser, no compiler, no capacity validation.**
  (SPEC §2.1) The library decorates authored DOM and runs a state machine.
- **Effects live in CSS.** Library outputs = classes, attributes, custom
  properties, events. Never a rendering behavior baked into JS. (SPEC §2.2)
- **Zero runtime dependencies.** devDependencies allowed (puppeteer-core,
  esbuild). (SPEC §3)
- **Size budgets:** src/scrolly.js ≤ 4 KB gz; src/scrolly.css ≤ 2 KB gz.
  (SPEC §3; enforced by existing test)
- **Classic script, works from `file://`.** `src/scrolly.js` stays a
  zero-build classic script exposing `window.Scrolly`. dist/ builds are
  ADDITIVE — src is never modularized in this drive. (SPEC §9)
- **No scroll-jacking, ever.** scrolly observes scroll; it never owns it.
  No wheel/touch hijack, no horizontal-scroll sections. (SPEC §2 principle
  in §11 "Ruled out")
- **Structural CSS only in the lib; aesthetics belong to authors/themes.**
  Themes must contain typography/color only — no position/grid/sticky/
  layout geometry. (SPEC §2.4, §6)
- **Attributes, not config objects.** No new options params. (SPEC §2.5)
- **Examples are fully self-contained:** lib inlined, no external URLs of
  any kind (images = inline SVG / data URIs / CSS-drawn), open from
  `file://`. No vendored third-party libs (no D3 — hand-rolled minimal
  graphic JS instead; keeps examples readable and self-contained).
- **Tier glue budgets (SPEC §14):** Tier 1 examples: the ONLY author
  JavaScript is `Scrolly.init(...)` (plus optional event logging: none).
  Tier 2: author JS may draw/animate the graphic but must contain NO
  scroll/trigger/sticky logic — no `addEventListener('scroll'|'wheel'|
  'touchmove')`, no `IntersectionObserver`, no `getBoundingClientRect` in
  author code; all choreography via scrolly events/custom properties.
- **The contract is stable:** class names (`is-past/is-active/is-future/
  is-shown/is-ready`), `data-active-step`, `--step-progress/--story-progress`,
  event names — frozen as tested by test/semantics.test.js. Examples adapt
  to the lib; the lib never adapts to an example.
- **Toolchain:** Bun; tests via `bun test` (puppeteer-core against system
  Chrome at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`);
  plain JS (no TypeScript, no linter — deliberate).
- **skill/assets/ mirrors src/** — any ticket touching src must re-copy both
  files (checked in baseline).

## Scope tripwire (halt if crossed)

- Any authoring format, markdown parser, or compile step for stories.
- Any chart/map library added to the lib or vendored into examples.
- Framework wrappers (React/Svelte/Vue).
- Any scroll hijacking (wheel/touch interception, scroll-behavior override
  beyond the existing keyboard `scrollTo`).
- Changes to state-machine semantics or the public contract (class/attr/
  var/event names, layout names) — that is a SPEC amendment, escalate.
- npm publish, GitHub publish, name changes — human-gated.
- New lib config options/parameters.

## Baseline gate (every ticket, no exceptions)

Run from repo root (`~/LocalWorkspace/scrolly`):
- [ ] syntax: `node --check src/scrolly.js` → exit 0
- [ ] full test suite: `bun test` → all pass (requires system Chrome)
- [ ] size budgets: enforced inside the suite (semantics.test.js)
- [ ] skill assets synced: `diff -q src/scrolly.js skill/assets/scrolly.js
      && diff -q src/scrolly.css skill/assets/scrolly.css` → exit 0
- [ ] new behavior ships with new tests green under the above (exempt:
      pure-content example tickets — their behavior IS checked by the
      validator, S101)
- [ ] determinism where builds exist: running the build twice yields
      byte-identical dist/ output

## Per-phase acceptance (executable; closes only on the merged tree)

### Phase A — Example infrastructure (S101)
- [ ] `node test/validate-story.mjs <file.html> [--tier1]` exists and exits
      0/1 with a JSON report (per story on multi-story pages): stepCount,
      **screenshot-hash-based** distinctGraphicStates, glueTier via
      **runtime instrumentation** (tier1|tier2|fail), externalUrls via
      **network interception**, consoleErrors (incl. pageerror before
      goto), bidirectionalConsistent incl. a non-monotonic traversal.
- [ ] **Contrast set (red-team-hardened, ledger [0004]):** PASSES
      `index.html` and the clean wheel-in-comment fixture; FAILS each of
      seven broken fixtures for its ONE stated reason (exclusivity
      asserted): dead-steps (pixel-identical states), external-url (https
      AND protocol-relative), fetch-external (runtime-constructed URL —
      proves interception), scroll-jack, scroll-jack-obfuscated (bracket/
      concat access), asymmetric-state (bidirectional only), runtime-error
      (consoleErrors only).
- [ ] Validator source contains no fixture filenames (no sniffing);
      validator.test.js runs fixtures from randomized temp copies.

### Phase B — Parity gallery (S102–S106)
- [ ] every `examples/*.html` passes `node test/validate-story.mjs` at its
      ticket's declared tier
- [ ] `bun test` green (regression guard)
- [ ] each example: ≥4 steps with ≥4 distinct graphic states; zero console
      errors from `file://`; scroll down THEN up ends in the same state as
      the first pass (bidirectional consistency — validator-checked)

### Phase C — Packaging (S107)
- [ ] `bun run build` → dist/scrolly.esm.js + dist/scrolly.iife.js +
      dist/scrolly.min.js produced; run twice → byte-identical
- [ ] ESM: `bun -e "const m = await import('./dist/scrolly.esm.js');
      if (typeof m.default.init !== 'function') process.exit(1)"` → exit 0
- [ ] IIFE + min: loaded in Chrome (puppeteer), `window.Scrolly.init` is a
      function and the fixture story activates step `a` at scrollY=1700
      (same math as semantics tests) — for BOTH files
- [ ] min budget: dist/scrolly.min.js ≤ 4 KB gz; `src/scrolly.js` untouched
      (git diff empty for src/ on this ticket)

### Phase D — Themes + docs closure (S108, S109)
- [ ] two theme files in `themes/`; each contains ONLY
      typography/color/spacing rules — validator: no `position`, `display:
      grid`, `sticky`, `grid-template`, `height: 100`, or media queries in
      themes (grep-based check, exact list in ticket)
- [ ] behavioral: puppeteer loads demo with/without theme link — computed
      `font-family` (or heading `font-size`) of a step h2 DIFFERS across the
      two loads; structural geometry (figure `position: sticky`) is
      IDENTICAL across the two loads
- [ ] docs: every relative link in README.md, SPEC.md, docs/recipes.md
      resolves to an existing file (link-check script); README gains a
      gallery section listing every file in examples/

## Caps

In `backlog.json`: maxAttempts 3 · thrash 2 · chunk **10** tickets/invocation.
