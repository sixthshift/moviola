# scrolly — specification

**Status:** draft for review. The README is the user-facing contract; this
document is the full requirements behind it — precise semantics, rationale,
and the conformance bar. Where the v0 scaffold already meets a requirement
it's marked ✅; where it doesn't, ⬜ (these are the work items); genuinely
open decisions are marked ❓.

---

## 1. Product statement

scrolly is to scrollytelling what reveal.js is to slides: the complete
framework layer for a form that has only ever had primitives (scrollama) and
niche formats (Closeread). You write semantic HTML; scrolly pins the graphic,
runs the scroll state machine, and expresses everything it knows as CSS-
reactable state. One script tag, one stylesheet, no build step.

Primary adopters, in order:
1. **AI agents** (Claude Code et al.) producing self-contained scrollytelling
   HTML — the reveal.js-for-slides usage pattern. Served by a SKILL.md, since
   scrolly has no training-data presence (§10).
2. **Developers** who today hand-roll sticky CSS + scrollama callbacks.
3. **Data-journalism / data-viz authors** graduating from bespoke builds.

## 2. Design principles

1. **Decorate, don't parse.** scrolly reads the DOM you wrote and stamps
   state onto it. No AST, no markdown, no compiler, no measurement, no
   validation. Overflow is between the author and their eyes — exactly
   reveal.js's contract.
2. **Effects live in CSS.** The library's only outputs are classes,
   attributes, and custom properties. If a feature can't be expressed that
   way, it gets an event — never a rendering behavior baked into JS.
   (reveal's `past/present/future` idea, generalized.)
3. **The zero-callback path must cover the common case.** Image crossfades,
   step-driven styling, and progress-driven animation must all work with no
   author JavaScript. The event API exists for D3-class graphics only.
4. **Structural CSS only.** scrolly.css owns geometry (pinning, columns,
   collapse) and visibility mechanics. It never owns typography, color, or
   aesthetics. Themes may do so later, as opt-in files (§12).
5. **Boring runtime, no config surface.** Attributes on the element, not an
   options object. Every knob must justify itself; defaults are the product.

### Non-goals (rejected, do not re-open casually)

- Markdown/authoring formats, capacity validation, compile-time anything —
  a future tool may *target* scrolly's conventions; scrolly stays ignorant
  of it.
- Chart/map rendering. The graphic is arbitrary author HTML.
- Scroll-jacking, smooth-scroll takeover, parallax physics. The browser owns
  scrolling; scrolly only observes it.
- Framework wrappers (React/Svelte/Vue) in core. Events bubble; wrappers can
  live outside.

## 3. Conformance targets

| Requirement | Bar | Status |
|---|---|---|
| Zero runtime dependencies | hard | ✅ |
| Size budget | ≤ 4 KB gzipped JS, ≤ 2 KB gzipped CSS | ✅ (measured on `dist/` by `test/unit/size.test.ts`) |
| Works from `file://` | classic script, no modules required | ✅ |
| Browser baseline | last-2-years evergreen (IntersectionObserver, CSS grid, custom properties, `:scope`, `100dvh` with `vh` fallback) | ✅ |
| No-JS degradation | page remains fully readable (§8.1) | ✅ |
| Multiple stories per page | independent state machines | ✅ |
| Idempotent teardown | `destroy()` restores the DOM it decorated | ✅ |

## 4. Document model (normative)

```html
<article class="scrolly" data-layout="side-right" data-offset="0.5">
  <figure>
    <!-- graphic: arbitrary HTML; children opt into step-driven visibility -->
    <img src="a.png" data-show="intro">
    <svg data-show="crash recovery">…</svg>
    <div>always visible (no data-show)</div>
  </figure>
  <section class="step" id="intro">…</section>
  <section class="step" id="crash">…</section>
  <section class="step" id="recovery">…</section>
</article>
```

Rules:

- **Root**: any element carrying class `scrolly`. `<article>` recommended.
- **Graphic**: the first *direct child* `<figure>`. Exactly one; absent is
  legal (a text-only stepper still gets classes/events).
- **Steps**: all *direct children* with class `step`, in DOM order.
  `<section>` recommended. Steps SHOULD carry an `id`: ids name states for
  `data-show` and `data-active-step`, and are native deep-link anchors. A
  step without an id is addressed by its zero-based index as a string.
- **`data-show`**: space-separated list of step ids (or index strings) on any
  descendant of the graphic. Graphic children without `data-show` are always
  visible.
- Content between/around steps and outside `.scrolly` is untouched — stories
  embed in normal article flow.
- A step's content SHOULD be a single block element (wrap in a `<div>` if
  more) — card styling in overlay/mobile modes targets `.step > *`.

## 5. State machine (normative semantics)

### 5.1 Trigger and active step

- The **trigger line** is a horizontal line at `viewportHeight × offset` from
  the viewport top. `offset` comes from `data-offset`, default **0.5**;
  valid range (0, 1).
- The **active step** is the *last* step in DOM order whose bounding-box top
  is at or above the trigger line. Consequences (all intentional):
  - Before the first step arrives: no active step. All steps `is-future`,
    `data-active-step` absent, `--step-progress` 0.
  - In the gap between two steps: the earlier step *stays* active (standard
    scrollytelling behavior — the graphic holds its state between chapters).
  - Past the last step: the last step stays active. State is retained, not
    cleared, when the story leaves the viewport (reveal retains state too).
  - Scrolling up is the exact mirror; correctness in reverse is a property
    of the algorithm, not a special case.
- Geometry is read live (`getBoundingClientRect`) on every update — late-
  loading images/fonts that change layout can never leave stale state.

### 5.2 Outputs (the CSS contract)

On every active-step change, atomically:

| Target | Output |
|---|---|
| each step | exactly one of `is-past` / `is-active` / `is-future` |
| root | `data-active-step="<id>"` (attribute absent when none) |
| each `[data-show]` element | `is-shown` toggled by whether its list contains the active id |

Continuously (rAF-throttled while the story intersects the viewport):

| Custom property (on root) | Semantics |
|---|---|
| `--step-progress` | 0→1 across the active step's **chapter**: from its top to the next step's top (the last step uses its own bottom). Chapter-based, so progress is smooth across the whitespace between steps. |
| `--story-progress` | 0→1 from the first step's top to the last step's bottom. |

### 5.3 Performance model

- One `IntersectionObserver` per story gates a passive scroll/resize
  listener; the rAF loop runs only while the story is on screen. ✅
- Per-frame work is bounded by step count (one rect read per step). No
  layout writes in the read path except the two custom properties and, on
  change, class toggles. ✅
- No scroll-linked visual math in JS: animation smoothness is delegated to
  CSS (`transition`, or author use of the custom properties). ✅

## 6. Structural CSS layer

### 6.1 Layouts (`data-layout`)

| Value | Geometry | Status |
|---|---|---|
| `side-right` | 2-col grid; sticky graphic right, steps left | ✅ |
| `side-left` | mirror | ✅ |
| `overlay` | full-width sticky graphic; steps as centered cards above it | ✅ |
| `full` | graphic is the whole stage; steps minimal/edge-aligned | ❓ deferred — decide post-v0.1 whether it's distinct from `overlay` or a card-style variant of it |
| *(none)* | author brings their own layout; state machine still runs | ✅ |

- Sticky frame: `figure` pins at `top: 0`, `height: 100dvh` (with `vh`
  fallback), children stacked in one grid cell for crossfade. ✅
- Steps default to `min-height: 90dvh`, content vertically centered. ✅
- **Mobile collapse**: below **720px**, side layouts become overlay
  (single column, card-styled steps). Fixed breakpoint, not configurable —
  revisit only with evidence. ✅
- Card knobs: `--scrolly-card-bg`, `--scrolly-card-fg`. The only theming
  surface in v0. ✅

### 6.2 Visibility mechanics

- `[data-show]` elements: `opacity: 0`, 0.4 s ease transition; `.is-shown`
  → `opacity: 1`. Crossfade is the default because siblings occupy the same
  grid cell. Authors override freely (the class, not the effect, is the
  contract). ✅

## 7. Events & JS API

### 7.1 Events (primary interface)

Bubbling, cancelable-irrelevant `CustomEvent`s dispatched on the root:

| Event | Fires | `detail` |
|---|---|---|
| `scrolly:stepenter` | step becomes active | `{ step, id, index, direction }` |
| `scrolly:stepexit` | step stops being active | `{ step, id, index, direction }` |
| `scrolly:progress` | each rAF tick while a step is active | `{ step, id, index, progress, storyProgress }` |

`direction` is `"down"` or `"up"`. Exit fires before enter. Plain DOM events
so every framework interops with zero glue.

### 7.2 API

```js
Scrolly.init()            // all .scrolly on the page → Story[]
Scrolly.init(elOrSel)     // one story → Story (throws if no match)
story.on(name, fn)        // sugar over addEventListener; name without prefix
story.destroy()           // teardown
Scrolly.version
```

`data-offset` on the element beats `opts.offset` beats the 0.5 default.

### 7.3 Gaps found by this spec pass

- ✅ (fixed) `story.on()` returns an unsubscribe function; `destroy()`
  removes all sugar-registered listeners.
- ✅ (fixed) `Scrolly.init()` is idempotent per element — re-init returns
  the existing Story (WeakMap-backed); `destroy()` releases the element.

### 7.4 Keyboard stepping ✅

While a story is on screen, `←`/`→` scroll to the previous/next step's
trigger point (smooth, or instant under `prefers-reduced-motion`). Bounds
are respected (no wrap). Guards: modifier keys pass through; keys are
ignored while focus is in an input/textarea/select/contenteditable. The
vertical-scroll keys (space, ↑↓, PgUp/PgDn) are never intercepted —
stepping is an enhancement, never scroll-jacking (principle 5, §2).

## 8. Accessibility & degradation

- **8.1 No-JS / JS-failed** ✅ **(fixed):** the runtime stamps `is-ready` on
  the root at init, and all visibility-hiding CSS is scoped under
  `.scrolly.is-ready`. A no-JS page shows all graphic states stacked but
  *readable* — degraded, never blank. `destroy()` removes the stamp.
- **Reduced motion**: `prefers-reduced-motion` disables the built-in
  transition; state changes become cuts. Progress variables still stream
  (authors must gate their own animations, documented in README). ✅
- **Print**: figure unpins, steps unstack, all graphic states visible,
  document linearizes. ✅
- **Semantics**: content order in the DOM is reading order; steps are real
  sections with real text (SEO/screen-readers read the story linearly).
  Decorative graphics SHOULD carry `aria-hidden="true"` (author guidance,
  README). ✅ (demo does)
- ❓ Whether `is-shown`/hidden graphic states should also toggle
  `visibility`/`inert` for the accessibility tree — decide in v0.2 with a
  screen-reader pass.

## 9. Packaging & distribution

- v0: classic script exposing `window.Scrolly`; CSS file alongside. ✅
- ✅ v0.2: dual ESM/classic build (originally a hand-maintained wrapper;
  see the v0.3 amendment below).
- ✅ **v0.3 amendment — internal toolchain**: `src/` is TypeScript modules
  built by Vite (`bun run build`); `dist/` is generated and committed. The
  *consumer* contract is unchanged and remains the conformance bar (§3):
  classic script from `file://`, zero runtime dependencies, size budgets.
  The bundler is repo tooling, never a consumer requirement. The canonical
  runtime artifact — the bytes embedded in examples, `skill/assets/`, and
  matched by the §14 validator's lib detection — is `dist/scrolly.iife.js`,
  kept in sync everywhere by `scripts/sync-embeds.mjs` and asserted by
  `test/unit/embeds.test.ts`. Only the classic (iife) script attaches
  `window.Scrolly`; the ESM build exports the same object as its default
  with no global side effect.
- ⬜ npm publish + CDN (jsdelivr/unpkg) once the name is settled.
- ❓ **Name**: "scrolly" is used semi-generically in the community and the
  npm name is likely taken. Verify; fallbacks to brainstorm if collision
  (e.g. scoped `@…/scrolly`, or a distinct name). Blocks npm/public launch
  only — not development.
- **Self-contained pattern** (the agent artifact): JS + CSS inlined into one
  HTML file. Must stay copy-paste-able — no external references anywhere in
  the lib. ✅ (property holds; template ships with the skill, §10)

## 10. Agent integration (release artifact, not afterthought)

The strategic goal: **Claude Code reaches for scrolly the way it reaches for
reveal.js.** scrolly has zero training-data presence; the skill closes that
gap because the entire authoring surface is ~5 conventions over HTML/CSS the
models already write fluently.

✅ `SKILL.md` v1 must contain:
1. When to use (scrollytelling / scroll-driven story / sticky-graphic
   explainer triggers).
2. The document model + full CSS contract (the tables from §5.2/§7.1,
   verbatim — they are small).
3. A complete self-contained single-file template (inlined lib) to copy and
   fill.
4. Layout selection guidance (side-* for prose+graphic, overlay for
   full-bleed visuals) and the single-block-per-step rule.
5. Common patterns: image sequence, D3 via events, progress-driven CSS
   animation, `data-active-step` page theming.

Acceptance test for the whole project (§13): a fresh Claude Code session
given only the skill produces a working scrollytelling piece on the first
render.

## 11. Recipes (documentation deliverable)

Most features people *expect* from scrollytelling are not library features —
they are one small pattern over the contract. Recipes are the official
answer to "does scrolly do X?", the same role patterns play in reveal's
docs. They ship as a docs page of copy-paste snippets (live examples where
feasible) and feed the SKILL.md patterns section (§10 item 5) verbatim.

**Rule: a recipe must fit in ~15 lines.** If a pattern can't, that is
evidence of a library gap — file it against the spec instead of publishing
a long recipe.

✅ v0.2 recipe set:

| Recipe | Mechanism |
|---|---|
| Progress bar | `transform: scaleX(var(--story-progress))` |
| Image flipbook / crossfade sequence | stacked `data-show` images (default behavior) |
| Chapter theming (bg/mood per step) | `[data-active-step="…"] { --accent: … }` |
| Text entrance effects | `.step.is-active` transitions |
| Animated counter | `stepenter` or `--step-progress`-driven |
| Parallax depth layers | `translateY(calc(var(--story-progress) * …))` |
| Map fly-to per step | `stepenter` → Mapbox/Leaflet `flyTo` |
| Stepped D3 chart build (bidirectional) | `stepenter` + `direction` |
| Video scrub | `progress` → `video.currentTime` |
| Per-chapter video play/pause | `stepenter`/`stepexit` (avoids the all-videos-autoplay bug) |
| Chapter nav dots | `stepenter` + native `#id` anchors |

Ruled out as recipes: horizontal-scroll sections (scroll-jacking adjacent,
violates principle 5 — scrolly observes scroll, never owns it).

## 12. Milestones

- **v0.1 — believable**: scaffold ✅; fix §7.3 + §8.1 ⬜; browser
  verification pass on macOS Chrome/Safari/Firefox incl. <720px collapse ⬜;
  demo feel-tuning ⬜.
- **v0.2 — adoptable**: SKILL.md + self-contained template; the recipes doc
  (§11); ESM build; keyboard stepping (scroll to next/prev step —
  enhancement, never scroll-jacking); 2–3 example stories (image sequence,
  D3, overlay); a11y decision from §8.
- **v1.0 — public**: name settled; npm + CDN; demo site (GitHub Pages);
  themes (typography presets); `full` layout decision executed.

## 13. Definition of done for "owns the lane"

Not a feature list — four observable outcomes:
1. The acceptance test in §10 passes cold.
2. A scrollama user can port an existing story by deleting their sticky CSS
   and trigger code and keeping their D3 (the event API is a superset of
   their callbacks).
3. The demo page communicates the entire contract without reading any docs
   (it currently attempts this; verify with fresh eyes).
4. The parity suite (§14) passes at its stated bar.

## 14. Success criteria — the parity suite

The ultimate test is recreation: canonical scrollytelling pieces, each a
bespoke newsroom build, re-implemented on scrolly. **The suite tests
choreography, not artwork**: the scoring boundary is that any failure must
trace to graphic rendering (author-land: charts, maps, video — out of
scope) and never to the pin/step/reveal/scrub choreography (lib-land: if the
choreography can't be expressed, that is a spec defect, not an excuse).

### Targets

Tiered by how much of the contract they exercise:

**Tier 1 — zero-glue choreography** (must work with no author JS beyond
rendering the graphic states themselves):

| Target | What it exercises |
|---|---|
| Bloomberg, *What's Really Warming the World?* (2015) | the classic stepped chart build: one sticky chart, each step adds/dims series → `data-show` / `data-active-step` styling |
| The Pudding, *Colorism in High Fashion* (2019) | sticky scatter with stepped highlight states; side layout; long prose between steps (gap behavior §5.1) |

**Tier 2 — event-API choreography** (D3-class graphics driven through
`stepenter`/`progress`; the scrollama-port test §13.2 in practice):

| Target | What it exercises |
|---|---|
| NYT Upshot, *…Punishing Reach of Racism for Black Boys* (2018) | animated particle flows re-triggered per step, bidirectional (down/up correctness) |
| NYT, *How the Virus Got Out* (2020) | sticky map with camera moves + particle states per step; overlay layout; step-driven page theming |
| R2D3, *A Visual Introduction to Machine Learning* (2015) | continuous scroll-linked transforms (`--step-progress` / `progress` event), not just discrete states |

**Tier 3 — the "within reason" boundary** (one required, to locate the
edge honestly):

| Target | What it exercises |
|---|---|
| NYT, *The Fine Line: Simone Biles* (2016) | scroll-scrubbed video (`progress` → `currentTime`) |
| NYT, *Snow Fall* (2012) — structure only | multiple independent stories in one longform page; full-bleed media; `overlay`+`side` mixed; ambient autoplay is out of scope |

### Parity rubric ("within reason", made concrete)

Per target, parity means:
- **Choreography** — pin, step triggers, state changes, scrub, and
  reverse-scroll behavior are indistinguishable in kind from the original.
- **Mobile** — the piece remains readable and choreographed under 720px via
  the built-in collapse (originals often shipped separate mobile builds;
  scrolly must get there with zero extra work).
- **Glue budget** — Tier 1: zero JS beyond drawing; Tier 2: author JS
  touches only the graphic, never scroll/trigger/sticky logic; Tier 3:
  one small binding (e.g. progress→currentTime) is acceptable.
- **Explicitly out of scope** — editorial art direction, custom typefaces,
  bespoke WebGL, data collection/journalism, CMS integration, ad/analytics
  scaffolding.

### Pass bar

- Both Tier 1 targets: full parity, zero glue, no lib changes.
- ≥ 2 of 3 Tier 2 targets: full parity with graphic-only author JS.
- ≥ 1 Tier 3 target: parity with its stated allowance.
- Every shortfall documented as either author-land (acceptable) or a filed
  lib defect (not acceptable to ship v1.0 with).

The recreations double as the example gallery (§12 v0.2/v1.0) — the suite
is not throwaway test matter; it is the public proof and the marketing.
