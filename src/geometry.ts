/**
 * Pure scroll geometry — no DOM, just numbers. The state machine's math
 * lives here so it can be unit-tested against the SPEC §5 semantics without
 * a browser.
 *
 * All positions are viewport-relative (as returned by getBoundingClientRect)
 * and `trigger` is the trigger line's distance from the viewport top.
 */

export const clamp = (v: number): number => Math.min(1, Math.max(0, v))

/**
 * Active step = the last step whose top has crossed the trigger line (§5.1).
 * Steps are scanned in document order and the scan stops at the first top
 * still below the trigger, so out-of-order geometry never activates a later
 * step early. Returns -1 while no step has crossed.
 */
export function activeIndex(stepTops: readonly number[], trigger: number): number {
  let active = -1
  for (const [i, top] of stepTops.entries()) {
    if (top > trigger) break
    active = i
  }
  return active
}

/**
 * 0→1 travel of the trigger line from the first step's top to the last
 * step's bottom. Degenerate (zero-height) spans guard with max(1, …) rather
 * than dividing by zero.
 */
export function storyProgress(firstTop: number, lastBottom: number, trigger: number): number {
  return clamp((trigger - firstTop) / Math.max(1, lastBottom - firstTop))
}

/**
 * 0→1 through a chapter: from the active step's top to `end` — the next
 * step's top, or the step's own bottom when it is the last (§5.2).
 */
export function stepProgress(top: number, end: number, trigger: number): number {
  return clamp((trigger - top) / Math.max(1, end - top))
}

/**
 * Per-step chapter progress (§15.2): the active step's chapter is
 * `stepProgress`; chapters already passed hold `1`; chapters not yet
 * reached are `0`. Both `tops` and `ends` are indexed by step, `ends[i]`
 * being the next step's top or (for the last step) its own bottom — the
 * same span `stepProgress` already runs. Composing `activeIndex` and
 * `stepProgress` means it inherits their exact-mirror-on-reverse property
 * and is monotonic non-increasing across steps at any scroll position.
 */
export function chapterProgress(
  tops: readonly number[],
  ends: readonly number[],
  trigger: number
): number[] {
  const active = activeIndex(tops, trigger)
  return tops.map((top, i) => {
    if (active < 0 || i > active) return 0
    if (i < active) return 1
    return stepProgress(top, ends[i] ?? top, trigger)
  })
}

/**
 * §15.3 the declarative camera: a shot is a target center (in the
 * `[data-camera]` element's own untransformed coordinate space) and a
 * magnification.
 */
export interface Shot {
  cx: number
  cy: number
  k: number
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * Interpolate two shots along the van Wijk–Nuij smooth pan-zoom flight
 * (§15.3), at the paper's default ρ = √2. The path is the geodesic of
 * zoom-pan space, so a long pan pulls OUT through its middle and back in
 * rather than sliding flat, and `t` maps linearly onto the path's arc
 * parameter — constant perceived velocity, with the reader's scroll pace as
 * the only easing there is (no duration, no easing knob; ρ is fixed in code).
 *
 * `worldWidth` is the stage's own width in the same untransformed camera
 * units as `cx`/`cy`, pinning view width to `w ≡ worldWidth / k`. That pin is
 * load-bearing: pan distance and view width have to be commensurable, and
 * feeding the closed form a normalized `1/k` against a world-unit pan is what
 * produces absurd mid-flight zoom-outs. It carries a default only because
 * every three-argument caller reaches a `worldWidth`-independent branch —
 * identical shots, zero pan distance, or an exact endpoint — where no value
 * of it can reach the result.
 */
export function interpolateShot(from: Shot, to: Shot, t: number, worldWidth = 1): Shot {
  // The endpoints short-circuit instead of round-tripping the closed form, so
  // a chapter boundary lands on its authored shot bit-exactly (and a
  // reduced-motion cut, which rounds `t`, only ever takes these two paths).
  if (t <= 0) return { ...from }
  if (t >= 1) return { ...to }

  const d = Math.hypot(to.cx - from.cx, to.cy - from.cy)
  // No pan distance to trade zoom against: the geodesic collapses to the pure
  // log-space ramp — equal zoom ratios per unit of progress. This is also the
  // identical-shot case, which it returns bit-exactly (`1 ** t` is exactly 1).
  // The bound is an absolute world-unit distance, sitting far above the scale
  // at which the general branch's `1 / (2 * d)` would amplify the cancellation
  // in `u`'s numerator into noise.
  if (d < 1e-6) {
    return {
      cx: lerp(from.cx, to.cx, t),
      cy: lerp(from.cy, to.cy, t),
      k: from.k * (to.k / from.k) ** t,
    }
  }

  // The paper's b/r substitution with ρ² = 2 and ρ⁴ = 4 folded in. `r` is the
  // arc parameter (up to the constant factor ρ), so lerping it in `t` is
  // exactly what makes progress linear in arc length. `-asinh(b)` is the
  // stable form of the paper's `ln(√(b²+1) − b)`, which cancels catastrophically
  // for a long pan at high zoom; it also hands back cosh(r0) = hypot(b0, 1)
  // and sinh(r0) = −b0 for free.
  const w0 = worldWidth / from.k
  const w1 = worldWidth / to.k
  const dw = w1 * w1 - w0 * w0
  const b0 = (dw + 4 * d * d) / (4 * w0 * d)
  const b1 = (dw - 4 * d * d) / (4 * w1 * d)
  const cosh0 = Math.hypot(b0, 1)
  const r = lerp(-Math.asinh(b0), -Math.asinh(b1), t)
  // `u` is the fraction of the pan already covered — the paper's u(s) divided
  // by the total distance, so it drives the same `lerp` the degenerate branch
  // uses. `from.k * cosh(r) / cosh(r0)` is `worldWidth / w(s)` with the
  // division by `w0` cancelled back out, keeping k off the round trip.
  const u = ((cosh0 * Math.tanh(r) + b0) * w0) / (2 * d)
  return {
    cx: lerp(from.cx, to.cx, u),
    cy: lerp(from.cy, to.cy, u),
    k: (from.k * Math.cosh(r)) / cosh0,
  }
}

/**
 * Default framing (§15.3): no `data-zoom` means "fit" — frame the target's
 * box at ~70% of the stage, whichever axis is tighter. Degenerate
 * zero-size boxes guard with max(1, …) rather than dividing by zero.
 */
export function fitZoom(targetW: number, targetH: number, stageW: number, stageH: number): number {
  const FRAME = 0.7
  return FRAME * Math.min(stageW / Math.max(1, targetW), stageH / Math.max(1, targetH))
}

/**
 * Compose a shot into the CSS transform applied to `[data-camera]`: move the
 * shot's target center to the stage's center, then scale around it. Values
 * are in the camera element's own local units (SVG's `transform` interprets
 * unitless `px` there as user units, so this composes correctly whether the
 * camera element renders at 1:1 or is scaled by an ancestor viewBox).
 */
export function cameraTransform(shot: Shot, stageCenter: { x: number; y: number }): string {
  return `translate(${stageCenter.x}px, ${stageCenter.y}px) scale(${shot.k}) translate(${-shot.cx}px, ${-shot.cy}px)`
}
