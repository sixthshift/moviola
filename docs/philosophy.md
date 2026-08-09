# Why moviola is shaped like this

The design argument. Nothing here is needed to use the library — start with
the [README](../README.md) for that.

## reveal.js, for scroll

reveal.js did this for slides: a document model, a tiny runtime, themes — and
your eyes do the QA. moviola is that same contract for scroll-driven stories.
No parser, no build step, no measuring API. One script tag, one stylesheet,
and markup you could have written by hand.

The consequence is that moviola has almost no API surface to learn. What it
has instead is a **contract**: a fixed set of classes, one attribute, and a
handful of custom properties. Everything you can express with CSS, you can
express in a moviola story, and moviola never has to know you did it.

## The reader holds the film

moviola has no clock. Nothing plays on its own: every state, and every frame
between two states, is a function of scroll position. That is why scrolling
back up rewinds instead of replaying, why a deep link into the middle of a
story renders the middle of the story, and why there is no such thing as
being out of sync with an animation that started while you were elsewhere.

It is also the constraint that generates the rest of the design. A story with
a clock needs play/pause, seek, and a way to reconcile the two timelines when
the reader scrolls during playback. A story that is purely positional needs
none of that — the scroll bar *is* the seek bar, and the browser already
shipped it.

## Effects belong in CSS

The runtime converts scroll geometry into declarative state and stops. It
never sets a visual property — no inline styles, no class-based animation
driving, no requestAnimationFrame tween loop of its own.

Two things follow. The library stays small enough to inline (4.5 KB gzipped,
zero dependencies), because it isn't carrying an effects engine. And your
effects are debuggable in devtools as CSS, by anyone who knows CSS, without
learning moviola's opinion about easing.

The motion layer is the same bet taken one step further: `data-scrub` stamps
one custom property and lets the browser's own `@keyframes` machinery do the
interpolation. The camera composes a transform and hands it to you as a
variable. In both cases moviola computes *where you are*, never *what that
should look like*.

## Compared to a callback library

Tools like scrollama solve the hard part of scrollytelling — "tell me when
step 3 is active" — and hand you a JavaScript callback. That is exactly right
when your graphic is imperative: a D3 chart, a canvas scene, a map that needs
`flyTo`. moviola keeps that door open, and its `on('stepenter')` signature is
deliberately familiar.

The bet is that most stories don't need it. A crossfading image sequence, a
highlighted cohort, a chart whose series appear one at a time, a camera
flying over an SVG — those are state changes, and CSS is already a very good
language for describing what a state looks like. Routing them through JS
callbacks means every author reimplements enter/exit symmetry, and gets it
subtly wrong in the reverse direction. Expressed as CSS reacting to
`[data-active-step]`, reverse is free: there is no transition to undo,
because there was no transition — just a different selector matching.

## What moviola deliberately is not

- **Not a parser or compiler.** There is no markdown, no AST, no build step.
  The document you author is the document that ships.
- **Not a chart library.** The graphic is arbitrary HTML or SVG. Bring D3, an
  `<img>`, or hand-written paths.
- **Not a layout validator.** Like reveal.js: if your text overflows, that is
  between you and your eyes. The library has no opinion about whether your
  story is any good.
- **Not a scroll-jacker.** The browser owns scrolling. Keyboard chapter
  stepping is an enhancement, and vertical scroll keys are never intercepted.

## The scars

Stated rather than hidden:

- The camera requires an SVG stage, because it works in the graphic's own
  coordinate space. Raster-only stories can still use raw-coordinate
  `data-focus`, but the image has to be wrapped in an `<svg>`.
- `data-morph` depends on the View Transitions API. Where it is unavailable
  the step change still happens, just without the transition.
- Side layouts collapse to overlay under 720px. That threshold is not
  configurable, on purpose — a knob here would mostly produce stories that
  were never checked at either width.
