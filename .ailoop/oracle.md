# Oracle — scrolly (v0.4 motion-layer drive)

The definition of done for driving `SPEC.md §15` (motion layer) to its
**machine-checkable subset**. Re-frozen at intake (2026-07-06), superseding
the v1-drive oracle (git history @ 9dba402; its phase gates all closed,
ledger [0010]). Brownfield: the tree is now the v0.3 toolchain (TypeScript
`src/`, Vite build, Vitest + Playwright, Biome) — verified at intake on
commits 6ffdab6 + 580ade3: typecheck, lint, 74 unit, 36 e2e, check-links
all green.

Frozen means never *silently* changed. Mechanical fixes self-serve with a
ledger entry; semantic changes escalate. Escaped-bug rule applies.

## Scope of this drive vs. human gates

This loop drives ONLY what is machine-checkable. **Explicitly outside the
loop** (human gates — never build around them, never mechanize them):
- The **DX quality judgment** (SPEC §15.7): SKILL cold-test first-render
  quality and "view-source teaches the rig" — mechanical floors ship in
  tickets; the judgment is Jason's.
- The browser **feel-pass** for flights and morphs (Chrome/Safari/Firefox,
  <720px, reduced-motion) — Jason's eyes.
- **Parity judgment** (§14 "indistinguishable in kind") on the re-cuts.
- The project **name**, npm publish, demo-site publish.
- SPEC ❓ decisions that are semantic: multi-chapter `data-scrub` spans,
  raw-coordinate `data-focus`, camera easing (van Wijk–Nuij). Proposals
  only; do not implement.

## Locked decisions (never re-litigated — cite in every worker prompt)

- **The existing contract is frozen; §15 is ADDITIVE ONLY.** New surface
  permitted by this drive, exactly as specced: `--progress-<id>`,
  `--camera-transform`, `data-scrub`, `data-camera`, `data-focus`,
  `data-zoom`, `data-morph`, console diagnostics. Existing class/attr/var/
  event names and semantics never change (e2e/semantics.spec.ts is the
  tripwire — it must pass unmodified except pure additions).
- **Effects live in CSS, §15 interpretation:** the runtime emits state
  (variables, one-time `--t` stamps) or batches its *existing* atomic
  writes (`data-morph` wraps only the §5.2 batch). Events fire
  synchronously, never delayed or reordered by a transition. Progress
  variables are never routed through View Transitions.
- **The camera never scrolls.** No `scrollTop`/`scrollTo`/`scrollBy`
  writes anywhere in the motion layer (keyboard.ts's existing stepping is
  the sole scroll writer in the lib). Validator instrumentation is the
  check.
- **Size bars (v0.4 amendment, Jason 2026-07-07, ledger [0020]):** the JS
  bar binds `dist/scrolly.min.js` ≤ 4 KB gz; CSS ≤ 2 KB gz
  (test/unit/size.test.ts). `dist/scrolly.iife.js` is REMOVED (M210) —
  `scrolly.min.js` is the canonical artifact for embeds, skill/assets, and
  the validator's lib byte-match; `src/` is the readable reference. Camera
  /morph/diagnostics land IN CORE under that bar (the §15.7 opt-in-split
  contingency is retired). Escalate BEFORE touching the bar values.
- **Per-frame work stays bounded by step count** (SPEC §5.3): the vars are
  `2 + N` writes; camera endpoints are measured on step-change/resize,
  never per frame; no new per-frame `getBoundingClientRect` beyond the
  existing per-step reads.
- **Attributes, not config objects.** No new init options.
- **No scroll-jacking, no physics/easing engine, no timeline format**
  (no `data-duration`, no sequencing config — time is scroll distance in
  author `@keyframes`).
- **Toolchain (v0.3):** `src/*.ts` is the source of truth; `dist/` is
  generated AND committed by `bun run build`; embeds re-synced by the
  build (`scripts/sync-embeds.mjs`); never hand-edit `dist/` or marker
  blocks. Gates: `bun run typecheck` · `bun run lint` · `bun run test`
  (Vitest) · `bun run test:e2e` (build + Playwright) ·
  `node scripts/check-links.mjs` · `git diff --exit-code dist examples
  skill/assets` — i.e. `bun run check`.
- **Generated-artifact allowlist:** every src-touching ticket implicitly
  touches the embed chain (dist/*, the marker blocks in examples/*.html and
  e2e/fixtures-*/*.html, skill/assets/*). These are allowlisted on every
  ticket alongside package.json/lockfiles; the file CONTRACT in
  backlog.json lists only intentionally-edited files.
- **Examples stay fully self-contained** (file://, zero external URLs, no
  vendored libs) and **tier budgets bind** (SPEC §14; validator-enforced).
- **Reduced-motion story is uniform:** every motion-layer output degrades
  to cuts (scrub quantizes via `round()`, camera snaps to nearer shot,
  morph no-ops). Progress variables still stream (SPEC §8).

## Scope tripwire (halt if crossed)

- Any authoring format, parser, or compile step for stories.
- Any chart/map library in the lib or vendored into examples.
- Framework wrappers.
- Any wheel/touch interception or scroll writes outside keyboard.ts.
- Renames or semantic changes to EXISTING contract surface — that is a
  SPEC amendment: escalate.
- Implementing any §15 item marked ❓ — proposals only.
- Moving the size bars.
- npm/GitHub publish, name changes — human-gated.

## Baseline gate (every ticket, no exceptions)

Run from repo root:
- [ ] `bun run check` → exit 0 (typecheck, lint, unit incl. size/embeds,
      build + e2e, link check, dist/embeds freshness)
- [ ] build determinism: `bun run build` twice → byte-identical `dist/`
- [ ] new behavior ships with new tests green under the above (exempt:
      pure-content example tickets — the §14 validator is their oracle)

## Per-phase acceptance (executable; closes only on the merged tree)

### Phase M-A — Core primitives (M201–M205, serialized on src/)
- [ ] `--progress-<id>`: pure function in geometry.ts, unit-tested for the
      SPEC §15.2 shape (0 before / scrubs through / holds 1 / exact mirror
      on reverse); e2e asserts the monotonic step-order property at three
      scroll positions and after an up-traversal.
- [ ] `data-scrub`: e2e drives a scrubbed element to 0%, ~50%, 100% of a
      chapter and asserts computed animation state advances and rewinds;
      reduced-motion emulation yields the quantized cut; `destroy()`
      removes stamps; a no-JS load leaves content readable.
- [ ] camera: mid-chapter screenshot differs from BOTH endpoint
      screenshots (a flight, not a cut — anti-gaming: no transition-timing
      tuning can fake this); zoom interpolation is log-space (unit-tested
      as pure math); dangling `data-focus` selector → camera holds +
      `scrolly:`-prefixed console.warn; validator instrumentation stays
      clean (no scroll writes, no author-attributed rect calls).
- [ ] `data-morph`: with it enabled, e2e/semantics.spec.ts event-order
      assertions pass unmodified; rapid non-monotonic traversal ends
      bidirectionally consistent (validator on a morph fixture); browsers
      without the API and reduced-motion take the existing cut path.
- [ ] diagnostics: dangling `data-show`/`data-scrub`/`data-focus` tokens
      warn once with `scrolly:` prefix; behavior otherwise unchanged
      (fail-soft asserted); zero warnings across index.html + all examples.

### Phase M-B — Tooling (M206–M207, parallel with M-A tail)
- [ ] `validate-story.mjs --report out.html` writes a self-contained
      contact sheet (per-step forward+reverse screenshots inline as data
      URIs; no external refs); default JSON behavior byte-identical
      without the flag.
- [ ] `scrolly-director.js`: zero diffs to core files; loading it renders
      the trigger line at `viewportHeight × offset` (computed-position
      check), a chapter rail that jumps on click, and live progress
      readouts; `d` toggles; removing the script tag restores a clean page.

### Phase M-C — Gallery re-cuts (M208)
- [ ] `examples/virus-got-out.html` re-cut on `data-camera`/`data-focus` +
      `data-scrub`: validator `--tier1` PASS, and the M-A mid-chapter
      flight check holds on it.
- [ ] `examples/scroll-linked.html` re-cut on `data-scrub`: `--tier1` PASS
      (author JS reduced to `Scrolly.init`).
- [ ] `examples/dots-flow.html` re-cut on `data-morph`: validator PASS at
      tier2 or better; author stepenter JS contains no motion
      interpolation (grep floor in ticket); distinctGraphicStates ≥ the
      pre-re-cut count for all three.
- [ ] NET-NEW recreation exercising camera + scrub together at Tier 1
      (SPEC §15.7 bullet 4; coverage correction, ledger [0035]):
      `examples/zoom-tour.html` — validator `--tier1` PASS bidirectional,
      the M-A mid-chapter flight probe holds (≥10 distinct
      `--camera-transform` values over a sweep; mid-chapter frame differs
      from both endpoints), ≥3 distinct `data-focus` targets, `data-scrub`
      present with author JS exactly `Scrolly.init`.

### Phase M-D — Docs closure (M209)
- [ ] README contract tables list every new variable/attribute; recipes
      for camera rig, scrubbed particles, morph regroup each ≤ 15 lines of
      code per SPEC §11 (counted in fenced blocks); SKILL.md updated;
      check-links green; SPEC §15 ⬜ flipped ✅ only for closed phases;
      zero ❓ lines modified.

## Caps

In `backlog.json`: maxAttempts 3 · thrash 2 · chunk **10** tickets/invocation.
