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

## Roadmap

- Themes (typography/spacing presets)
- `full` layout variant
- npm publish + ESM build

## License

MIT
