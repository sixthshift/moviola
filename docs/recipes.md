# Recipes

The official answer to "does moviola do X?" — most expected scrollytelling
features are one small pattern over the contract, not library features. Every
recipe here fits in ~15 lines; if you find one that can't, that's a library
gap — file an issue.

All recipes assume the quick-start document model from the README.

## Progress bar

```html
<div class="bar"></div>
<style>
  .bar { position: fixed; top: 0; left: 0; height: 4px; width: 100%;
         background: crimson; transform-origin: left;
         transform: scaleX(var(--story-progress, 0)); }
</style>
```
Put `.bar` inside the `.moviola` element (custom properties are set there).

## Image flipbook / crossfade sequence

The default behavior — stack images, tag each with its step:

```html
<figure>
  <img src="1.jpg" data-show="intro">
  <img src="2.jpg" data-show="crash">
  <img src="3.jpg" data-show="recovery aftermath">  <!-- spans two steps -->
</figure>
```

## Chapter theming

Any CSS can react to the active step via the root attribute:

```css
.moviola[data-active-step="crash"] { background: #1a0d0d; }
.moviola[data-active-step="crash"] h2 { color: crimson; }
```

## Text entrance effects

```css
.step > * { opacity: 0.3; transform: translateY(8px); transition: 0.3s; }
.step.is-active > * { opacity: 1; transform: none; }
```

## Animated counter

```js
story.on('progress', ({ id, progress }) => {
  if (id !== 'growth') return
  counter.textContent = Math.round(progress * 4700).toLocaleString()
})
```

## Parallax depth layers

```css
.layer-back  { transform: translateY(calc(var(--story-progress) * -40px)); }
.layer-front { transform: translateY(calc(var(--story-progress) * -120px)); }
```

## Map fly-to per step (Mapbox / Leaflet / MapLibre)

```js
const views = {
  intro: { center: [151.2, -33.8], zoom: 9 },
  crash: { center: [-74.0, 40.7], zoom: 11 }
}
story.on('stepenter', ({ id }) => views[id] && map.flyTo(views[id]))
```

## Stepped D3 chart build (bidirectional)

```js
const states = { intro: drawBase, crash: highlight2008, recovery: showRecovery }
story.on('stepenter', ({ id, direction }) => states[id]?.(direction))
```
Make each state function idempotent (draw the *full* state, not a delta) and
reverse scrolling works for free.

## Video scrub

```js
story.on('progress', ({ id, progress }) => {
  if (id === 'vault' && video.duration)
    video.currentTime = progress * video.duration
})
```
Serve the video with keyframes every frame (`-g 1` in ffmpeg) or scrubbing
will stutter.

## Per-chapter video play/pause

```js
story.on('stepenter', ({ id }) => { if (id === 'flood') video.play() })
story.on('stepexit',  ({ id }) => { if (id === 'flood') video.pause() })
```
This is the fix for the classic all-videos-autoplay-at-once bug.

## Chapter nav dots

```html
<nav class="dots">
  <a href="#intro"></a><a href="#crash"></a><a href="#recovery"></a>
</nav>
<style>
  .dots a { display: block; width: 10px; height: 10px; border-radius: 50%;
            background: #ccc; margin: 6px; }
</style>
```
```css
.moviola[data-active-step="crash"] .dots a[href="#crash"] { background: crimson; }
```
Step `id`s are native anchors, so the links work with zero JS; the attribute
selector lights up the current dot.

## Camera rig (`data-camera` / `data-focus` / `data-zoom`)

Mark the stage once; point each step at what to look at. No math, no CSS —
the runtime composes the transform and flies between shots as the reader
scrolls.

```html
<figure>
  <svg viewBox="0 0 2000 1000">
    <g data-camera>
      <circle id="wuhan" cx="1560" cy="430" r="1"/>
    </g>
  </svg>
</figure>
<section class="step" id="outbreak" data-focus="#wuhan" data-zoom="6.5">…</section>
<section class="step" id="world" data-focus="#the-map">…</section>
```
`data-zoom` is optional — omit it and the camera fits the target at ~70% of
the stage. A step without `data-focus` holds the previous shot.

## Scrubbed particles (`data-scrub` + `offset-path`)

Ride a path across a chapter's own scroll span — no `stepenter`, no manual
progress math:

```html
<circle class="mote" data-scrub="trains" style="offset-path:url(#rail)"/>
```
```css
.mote[data-scrub] { animation-name: ride; }
@keyframes ride {
  from { offset-distance: 0%; }
  to   { offset-distance: 100%; }
}
```
Scrolling back rewinds the mote; it stays arrived once the chapter passes.

## Morph regroup (`data-morph` + `view-transition-name`)

Redraw the full state on every `stepenter` as usual; `data-morph` upgrades
the snap into a native FLIP-style travel for any element you name:

```html
<article class="moviola" data-morph>
```
```js
dotEls.forEach((el, i) => { el.style.viewTransitionName = `dot-${i}` })
story.on('stepenter', ({ id }) => drawStep(id))  // sets cx/cy per dot, full state
```
`drawStep` stays a plain idempotent redraw (same rule as stepped D3 builds,
above) — `data-morph` only changes how the browser paints the transition
between two calls, never the redraw logic itself.

## Ruled out

Horizontal-scroll sections: moviola observes scroll, it never owns it.
Hijacking the wheel to move sideways breaks reader trust, accessibility, and
the entire premise. Use more steps instead.
