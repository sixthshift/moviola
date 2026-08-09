# API reference

Everything moviola writes to the DOM, and the one function that starts it.
For the normative version see [SPEC.md](../SPEC.md); this page is the
author-facing read of it.

- [Document model](#document-model)
- [State surfaces](#state-surfaces)
- [Attributes](#attributes)
- [The motion layer](#the-motion-layer)
- [JS API](#js-api)
- [Diagnostics](#diagnostics)

## Document model

```html
<article class="moviola" data-layout="side-right">
  <figure>…the graphic; pins to the viewport…</figure>
  <section class="step" id="intro">…prose…</section>
  <section class="step" id="crash">…prose…</section>
</article>
```

One `<figure>` (optional) and any number of `.step` sections. The figure
pins; the steps scroll past it. As each step crosses the trigger line the
state machine updates classes, attributes, and custom properties — nothing
else. moviola never touches a visual property.

Steps should carry `id`s. An id names a state for `data-show`, `data-focus`,
and `data-active-step`, and gives you a deep link (`page.html#crash`) for
free.

## State surfaces

| Surface | What it carries |
|---|---|
| `.step` classes | `is-past` / `is-active` / `is-future` |
| `.moviola[data-active-step="id"]` | lets any selector on the page react to any step |
| `[data-show="id …"]` graphic children | `is-shown` while a listed step is active (crossfade by default) |
| `--step-progress` | 0 → 1 through the active step's chapter (its top to the next step's top) |
| `--story-progress` | 0 → 1 through the whole story |
| `--progress-<id>` | per-chapter progress for any step with a valid-ident `id`: `0` before it, `0 → 1` through it, holds `1` after — unlike `--step-progress`, never resets |
| `--camera-transform` | the current camera shot on `[data-camera]`, continuously interpolated between focused steps |

Custom properties are set on the `.moviola` root, so anything inside it can
read them.

### `data-show` ranges

A token may name a single step or span a range:

| Token | Shown during |
|---|---|
| `data-show="crash"` | the `crash` chapter |
| `data-show="crash recovery"` | either chapter |
| `data-show="a..b"` | `a` through `b` inclusive |
| `data-show="a.."` | `a` to the end |
| `data-show="..b"` | the start through `b` |
| `data-show=".."` | the whole story |

## Attributes

| Attribute | Where | What it does |
|---|---|---|
| `data-layout` | the root | `side-right` · `side-left` · `overlay`. Side layouts collapse to overlay under 720px. |
| `data-offset` | the root | trigger line as a fraction of viewport height (default `0.5`) |
| `id` | each step | names the state; see above |

## The motion layer

Declarative interpolation between states. No JS runs the animation — moviola
stamps a variable and the browser renders the motion
([SPEC §15](../SPEC.md)).

| Attribute | Where | What it does |
|---|---|---|
| `data-scrub="<step-id>"` (or valueless) | any element | stamps `--t` from `var(--progress-<id>)` (or `var(--story-progress)`); scrubs the element's own `@keyframes` against scroll position via structural CSS |
| `data-camera` | one element inside the `<figure>` (SVG content) | opts the graphic in as the camera stage |
| `data-focus="<selector>"` or `data-focus="x y w h"` | the root, or any step | names what the camera looks at — an element to measure, or a raw box in the camera's own coordinates (a leading digit or `-` picks the box form); the root's own shot is the establishing view |
| `data-zoom="<n>"` | alongside `data-focus` | magnification; omitted = fit the target at ~70% of the stage |
| `data-shot="<name>"` | alongside `data-focus` | named framing instead of a number: `wide` fits the subject to half the stage, `medium` to the 70% default, `close` to 90%; a `data-zoom` on the same element wins |
| `data-morph` | the root | wraps each step-change's DOM writes in `document.startViewTransition()`; name elements with `view-transition-name` to have them travel instead of cross-fade |

The camera stage has to be SVG: the camera composes its transform in the
graphic's own coordinate space, and a bare `<img>` has none. Consume the
result yourself — the library sets the variable, your CSS applies it:

```css
.moviola.is-ready [data-camera] { transform: var(--camera-transform, none) }
```

Under `prefers-reduced-motion: reduce` every scrub becomes a cut at its
chapter's midpoint, and camera flights become cuts between shots.

## JS API

Only needed for imperative graphics (D3, canvas, maps). Declarative stories
need `Moviola.init()` and nothing else.

```js
const story = Moviola.init('#unemployment')   // or Moviola.init() for all
const off = story.on('stepenter', ({ step, id, index, direction }) => { … })
story.on('stepexit',  ({ id, direction }) => { … })
story.on('progress',  ({ id, progress, storyProgress }) => { … })
off()             // on() returns an unsubscribe function
story.destroy()   // full teardown; init() is idempotent per element
```

`Moviola.init()` with no argument initializes every `.moviola` on the page and
returns an array; with a selector or element it returns the single story.

Events are also plain bubbling `CustomEvent`s (`moviola:stepenter`,
`moviola:stepexit`, `moviola:progress`), so any framework can listen without
the sugar:

```js
document.addEventListener('moviola:stepenter', e => console.log(e.detail.id))
```

Handlers should draw **full state from the step id** rather than accumulate —
a reader can arrive at any chapter from either direction, or jump straight to
it via the URL fragment.

## Diagnostics

Referential mistakes never break the page. A `data-show` / `data-scrub` /
`data-focus` token matching nothing, or a `data-camera` rig with no
`data-focus` anywhere, fails soft and logs a `moviola:`-prefixed
`console.warn` once.

A page whose JS never runs stays fully readable: all hiding CSS is scoped
under `.moviola.is-ready`, which the runtime stamps last.
