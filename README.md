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
| `[data-show="id …"]` graphic children | `is-shown` while a listed step is active (crossfade by default) |
| `.scrolly[data-active-step="id"]` | lets any selector on the page react to any step |
| `--step-progress` | 0 → 1 through the active step's chapter (its top to the next step's top) |
| `--story-progress` | 0 → 1 through the whole story |

### Attributes

- `data-layout` — `side-right` · `side-left` · `overlay`. Side layouts
  collapse to overlay automatically under 720px.
- `data-offset` — trigger line as a fraction of viewport height
  (default `0.5`).
- Steps should have `id`s — they name states for `data-show` and
  `data-active-step`, and give you deep links (`page.html#crash`) for free.

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
| `examples/dots-flow.html` | 2 | Bidirectional particle-flow SVG re-triggered per step via `stepenter`, `side-right` layout |
| `examples/scroll-linked.html` | 2 | Continuous scroll-linked SVG transform driven by `--step-progress`, `overlay` layout |
| `examples/longform.html` | 3 | Three independent stories on one page, mixing `side-right`, `overlay`, and `side-left` layouts |
| `examples/virus-got-out.html` | 1 | Structural recreation of the SPEC §14 Tier 2 target *How the Virus Got Out* (NYT 2020): CSS camera fly-tos per step, SMIL particle flows, a scroll-linked case bloom on `--story-progress`, chapter theming, `overlay` layout — zero author JS |

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
