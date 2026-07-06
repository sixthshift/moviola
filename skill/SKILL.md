---
name: scrolly
description: >-
  Build scrollytelling pages — scroll-driven stories where a pinned graphic
  changes as prose steps scroll past (NYT/Pudding-style explainers, data
  stories, product narratives, annotated walkthroughs). Use whenever the user
  asks for scrollytelling, a scroll-driven story/explainer, a sticky-graphic
  narrative, or "slides but you scroll". Produces a single self-contained
  HTML file using the scrolly library (zero dependencies, works offline from
  file://).
---

# Building scrollytelling pages with scrolly

scrolly is a state machine over scroll: you write plain HTML (a pinned
`<figure>` + prose steps), and the library stamps state onto the DOM as the
reader scrolls. **All effects are CSS reacting to that state** — you rarely
write JavaScript beyond one init line.

## Output format

Produce ONE self-contained HTML file:
1. Inline the entire contents of `assets/scrolly.css` in a `<style>` tag.
2. Inline the entire contents of `assets/scrolly.js` in a `<script>` tag
   (before `</body>`).
3. Never reference external URLs — images should be data URIs, inline SVG,
   or CSS-drawn. The file must open from `file://` with no network.

## Document model (this exact shape)

```html
<article class="scrolly" data-layout="side-right">
  <figure>
    <!-- the pinned graphic: arbitrary HTML, stacked for crossfades -->
    <svg data-show="intro">…</svg>
    <svg data-show="crash recovery">…</svg>   <!-- visible on 2 steps -->
    <div>no data-show = always visible</div>
  </figure>
  <section class="step" id="intro"><p>…prose…</p></section>
  <section class="step" id="crash"><p>…prose…</p></section>
  <section class="step" id="recovery"><p>…prose…</p></section>
</article>
<script>Scrolly.init()</script>
```

Rules:
- `figure` must be a direct child; steps must be direct children with class
  `step`. Content elsewhere on the page flows normally — stories embed in
  articles, and a page can hold several `.scrolly` stories.
- Every step gets an `id` — ids name states for `data-show` and
  `data-active-step`, and are deep-linkable anchors.
- Keep each step's content in ONE block element (wrap in a `<div>` if more)
  — overlay/mobile card styling targets `.step > *`.
- Steps hold 1–3 short paragraphs. Long prose belongs between stories.

## The state contract (what your CSS reacts to)

| State | Where | Use for |
|---|---|---|
| `is-past` / `is-active` / `is-future` | each step | text entrance/dim effects |
| `is-shown` | graphic children with `data-show` | crossfades (default: 0.4s opacity) |
| `data-active-step="id"` | the `.scrolly` root | restyle ANYTHING per step: `.scrolly[data-active-step="crash"] .dot { fill: red }` |
| `--step-progress` (0→1 through active step) | root, inherits everywhere | scrubbed animation: `transform: scaleX(var(--step-progress))` |
| `--story-progress` (0→1 whole story) | root | progress bars, parallax |

## Layout selection

| Layout | When |
|---|---|
| `side-right` (default choice) | prose + chart/diagram/data graphic |
| `side-left` | same, when the graphic should lead visually |
| `overlay` | full-bleed imagery/maps; steps become floating cards |

All layouts collapse to overlay automatically under 720px — mobile is
handled; do not write mobile CSS for the story structure.

## JS API (only for imperative graphics — D3, maps, video)

```js
const story = Scrolly.init('#my-story')   // or Scrolly.init() for all
story.on('stepenter', ({ id, direction }) => { /* set graphic state */ })
story.on('stepexit',  ({ id, direction }) => { … })
story.on('progress',  ({ id, progress, storyProgress }) => { /* scrub */ })
```

Make each step's handler draw the FULL state for that step (idempotent, not
a delta) — reverse scrolling then works for free.

## Patterns

- **Chapter theming**: `.scrolly[data-active-step="x"] { --accent: … }` —
  shift page mood per chapter. High impact, zero JS.
- **Stepped chart build**: one chart in the figure, series/annotations tagged
  `data-show="step2 step3"` (elements stay visible across listed steps) or
  highlighted via `data-active-step` selectors.
- **Image sequence**: stacked `<img data-show="…">` — crossfade is default.
- **Progress bar**: `transform: scaleX(var(--story-progress))` on a fixed
  bar inside the story.
- **Video**: scrub with `progress` → `currentTime`; play/pause on
  `stepenter`/`stepexit` — never let all videos autoplay together.
- **Counter**: update `textContent` from `progress` for numbers that count
  up while the reader scrolls a step.

## Quality bar

- 4–8 steps per story; every step must change the graphic (a step with no
  visible change is a dead step — cut it or give it a state).
- The graphic must be legible at every step in isolation.
- Respect the reader: no scroll-jacking, no autoplaying audio; the prose
  must read as a complete story linearly (screen readers/print see it that
  way).
- Dark or light theme both fine, but text over graphics needs contrast —
  overlay steps get card backgrounds via `--scrolly-card-bg`/`-fg`.
