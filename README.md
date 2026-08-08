# scrolly

**The scrollytelling framework.** You write the DOM, scrolly runs the state
machine, effects live in your CSS.

reveal.js did this for slides: a document model, a tiny runtime, themes — and
your eyes do the QA. scrolly is that contract for scroll-driven stories: no
parser, no build step, no measuring. One script tag, one stylesheet.

## Quick start

```html
<link rel="stylesheet" href="scrolly.css">

<article class="scrolly" data-layout="side-right">
  <figure>
    <img src="map.png" data-show="intro">
    <img src="map-2008.png" data-show="crash recovery">
  </figure>
  <section class="step" id="intro">…prose…</section>
  <section class="step" id="crash">…prose…</section>
  <section class="step" id="recovery">…prose…</section>
</article>

<script src="scrolly.js"></script>
<script>Scrolly.init()</script>
```

The `<figure>` pins to the viewport; steps scroll past it. As each step
crosses the trigger line, the state machine updates classes, attributes, and
CSS variables — your CSS does the rest. Open `index.html` for the live demo
(it works from `file://`, no server needed).

## The contract

Everything scrolly does is expressed as state your CSS can react to:

| Surface | What it carries |
|---|---|
| `.step` classes | `is-past` / `is-active` / `is-future` |
| `[data-show="id …"]` graphic children | `is-shown` while a listed step is active (crossfade by default); a token may span a range — `a..b`, `a..`, `..b`, `..` |
| `.scrolly[data-active-step="id"]` | lets any selector on the page react to any step |
| `--step-progress` | 0 → 1 through the active step's chapter (its top to the next step's top) |
| `--story-progress` | 0 → 1 through the whole story |
| `--progress-<id>` | per-chapter progress for any step with a valid-ident `id`: `0` before it, `0 → 1` through it, holds `1` after — unlike `--step-progress`, never resets |
| `--camera-transform` | the current camera shot on `[data-camera]`, continuously interpolated between focused steps |

### Attributes

- `data-layout` — `side-right` · `side-left` · `overlay`. Side layouts
  collapse to overlay automatically under 720px.
- `data-offset` — trigger line as a fraction of viewport height
  (default `0.5`).
- Steps should have `id`s — they name states for `data-show` and
  `data-active-step`, and give you deep links (`page.html#crash`) for free.

### The motion layer

Declarative interpolation between states — no JS, the browser renders the
motion (SPEC §15):

| Attribute | Where | What it does |
|---|---|---|
| `data-scrub="<step-id>"` (or valueless) | any element | stamps `--t` from `var(--progress-<id>)` (or `var(--story-progress)`); scrubs the element's own `@keyframes` against scroll position via structural CSS |
| `data-camera` | one element inside the `<figure>` (SVG content) | opts the graphic in as the camera stage |
| `data-focus="<selector>"` or `data-focus="x y w h"` | the root, or any step | names what the camera looks at — an element to measure, or a raw box in the camera's own coordinates (a leading digit or `-` picks the box form); the root's own shot is the establishing view |
| `data-zoom="<n>"` | alongside `data-focus` | magnification; omitted = fit the target at ~70% of the stage |
| `data-shot="<name>"` | alongside `data-focus` | named framing instead of a number: `wide` fits the subject to half the stage, `medium` to the 70% default, `close` to 90%; a `data-zoom` on the same element wins |
| `data-morph` | the root | wraps each step-change's DOM writes in `document.startViewTransition()`; name elements with `view-transition-name` to have them travel instead of cross-fade |

Referential mistakes (a `data-show`/`data-scrub`/`data-focus` token matching
nothing, or a `data-camera` rig with no `data-focus` anywhere) never break the
page — they fail soft and log a `scrolly:`-prefixed `console.warn` once.

### JS API

Only needed for imperative graphics (D3, canvas, maps). scrollama users will
recognize it:

```js
const story = Scrolly.init('#unemployment')   // or Scrolly.init() for all
const off = story.on('stepenter', ({ step, id, index, direction }) => { … })
story.on('stepexit',  ({ id, direction }) => { … })
story.on('progress',  ({ id, progress, storyProgress }) => { … })
off()             // on() returns an unsubscribe function
story.destroy()   // full teardown; init() is idempotent per element
```

Events are plain bubbling `CustomEvent`s (`scrolly:stepenter` …), so any
framework can listen without the sugar.

## Recipes

The full set lives in [docs/recipes.md](docs/recipes.md). These two are whole
stories rather than fragments — paste either into a page that already loads
`scrolly.css` and `scrolly.js` and it runs — and each ships as a live fixture
(`e2e/fixtures-clean/recipe-*.html`) the e2e suite scrolls end to end, so a
recipe that stops working cannot stay published.

### A photo as the camera stage

A raster gives a selector nothing to point at, which is what raw-coordinate
`data-focus` is for: each shot names a box of the image itself.

```html
<article class="scrolly" data-layout="side-right">
  <figure>
    <svg viewBox="0 0 320 200" width="100%" height="100%">
      <g data-camera>
        <image width="320" height="200" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAUCAMAAADbT899AAAAElBMVEUbT3I2faNOejptnE7PybizRS+ryHFxAAAAYUlEQVR42sWOSQ7AMAgDATv//3LVKguoFuqtXBwxI2KzP4eflr5fYwjf/S14nTjHmTAXjirMXZksCFyEhQFgZhKcrHzFbk1KvoUgA4LDTh3JjwDNw+THKQw9fy50/O7QclzLewORR14f8wAAAABJRU5ErkJggg=="/>
      </g>
    </svg>
  </figure>
  <section class="step" id="coast" data-focus="0 0 320 200" data-shot="wide"><p>The whole coast.</p></section>
  <section class="step" id="jetty" data-focus="60 40 80 110" data-shot="medium"><p>Down to the jetty.</p></section>
  <section class="step" id="hut" data-focus="70 40 40 40" data-shot="close"><p>The hut at its end.</p></section>
</article>
```

That `data:` URI is a 32×20 stand-in — swap in your own `photo.jpg`. The stage
has to be SVG: the camera composes its transform in the graphic's own
coordinate space, and a bare `<img>` has none. The boxes are read in that same
space, so `0 0 320 200` is the whole `viewBox`.

### Scrubbing one chapter

```html
<style>
  .dial { width: 300px; height: 40px; background: #dde3ee }
  .needle { width: 6px; height: 40px; background: crimson }
  .needle[data-scrub] { animation-name: sweep }
  @keyframes sweep { from { transform: translateX(0) } to { transform: translateX(294px) } }
</style>
<article class="scrolly" data-layout="side-right">
  <figure>
    <div class="dial"><div class="needle" data-scrub="rising"></div></div>
  </figure>
  <section class="step" id="calm"><p>The needle waits at 0%.</p></section>
  <section class="step" id="rising"><p>Through this chapter it tracks your scroll.</p></section>
  <section class="step" id="after"><p>Arrived — and it rewinds if you scroll back up.</p></section>
</article>
```

You own `animation-name` and nothing else: scrolly stamps `--t` from
`var(--progress-rising)` and normalizes the duration, so the `@keyframes` are
the whole timeline. Drop the value — plain `data-scrub` — to scrub against
`--story-progress` instead of one chapter. Under `prefers-reduced-motion` every
scrub becomes a cut at its chapter's midpoint.

## What scrolly deliberately is not

- Not a parser or compiler — there is no markdown, no AST, no build.
- Not a chart library — the graphic is arbitrary HTML; bring D3 or an `<img>`.
- Not a layout validator — like reveal.js, if your text overflows, that's
  between you and your eyes.

Keyboard: `←`/`→` step between chapters while a story is on screen (smooth,
reduced-motion aware). Vertical scroll keys are never touched.

## Gallery

Each example is a self-contained `file://`-openable HTML page (the library
is inlined between `<!-- scrolly:js/css -->` markers and kept in sync with
`dist/` by the build). Tier follows the parity suite (SPEC §14) — Tier 1
examples run zero author JS beyond rendering the graphic states, and are
verified against `scripts/validate-story.mjs --tier1`.

| Example | Tier | What it demonstrates |
|---|---|---|
| `examples/warming-world.html` | 1 | Stepped line-chart build — six illustrative warming factors added one at a time, `side-right` layout |
| `examples/stepped-scatter.html` | 1 | Sticky 60-point scatter with stepped cohort highlighting and long prose gaps between steps, `side-left` layout |
| `examples/dots-flow.html` | 2 | Bidirectional particle-flow SVG re-triggered per step via `stepenter`, each dot travelling via `data-morph` + `view-transition-name` instead of snapping, `side-right` layout |
| `examples/scroll-linked.html` | 1 | A classifier's boundary rotating and its points drifting, both pure `@keyframes` scrubbed against scroll position by `data-scrub` — zero author JS, `overlay` layout |
| `examples/longform.html` | 3 | Three independent stories on one page, mixing `side-right`, `overlay`, and `side-left` layouts |
| `examples/virus-got-out.html` | 1 | Structural recreation of the SPEC §14 Tier 2 target *How the Virus Got Out* (NYT 2020): `data-camera`/`data-focus`/`data-zoom` camera flights per step, `data-scrub` + `offset-path` particle flows, a scroll-linked case bloom on `--story-progress`, chapter theming, `overlay` layout — zero author JS |
| `examples/zoom-tour.html` | 1 | R2D3-style zoom tour of a decision tree learning to split a home-price dataset: nine `data-camera`/`data-focus`/`data-zoom` flights across one large stage, with two home clusters and both split lines moving continuously under `data-scrub` in the SAME chapters the camera is touring, `overlay` layout — zero author JS |

## Themes

Typography/color presets, opt-in, loaded after `scrolly.css`:

```html
<link rel="stylesheet" href="scrolly.css">
<link rel="stylesheet" href="themes/editorial.css">
```

- `themes/editorial.css` — warm serif (Georgia/Iowan Old Style).
- `themes/system.css` — tight neutral `system-ui`.

Themes only set typography, color, and the `--scrolly-card-bg` /
`--scrolly-card-fg` knobs — never geometry. Write your own stylesheet if
neither fits; the contract is the classes and custom properties, not these
files.

## Development

`src/` (TypeScript modules) is the source of truth; `dist/` is generated by
`bun run build`, committed, and is what every page here loads — so the repo
stays `file://`-openable. Never hand-edit `dist/` or the examples' inlined
lib blocks; the build re-syncs them.

- `dist/scrolly.min.js` — classic `<script>`, minified; the canonical artifact.
- `dist/scrolly.esm.js` — `import Scrolly from 'scrolly'` (no global side effect).
- `dist/scrolly.d.ts` / `dist/scrolly.css` — types and the structural stylesheet.

Everyday commands: `bun run dev` (Vite playground) · `bun run test` (Vitest
units) · `bun run test:e2e` (build + Playwright) · `bun run check`
(everything, plus dist-freshness). See [CONTRIBUTING.md](CONTRIBUTING.md)
and [ARCHITECTURE.md](ARCHITECTURE.md).

## Roadmap

- `full` layout variant
- npm publish (name TBD — see SPEC §9)

## License

MIT
