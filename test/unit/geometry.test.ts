/*
 * SPEC §5 math, tested as pure numbers — no browser, no DOM. These are the
 * exact functions Story._update() acts on, so every boundary here is a
 * boundary the state machine has.
 */
import { describe, expect, test } from 'vitest'
import {
  activeIndex,
  cameraTransform,
  chapterProgress,
  clamp,
  fitZoom,
  interpolateShot,
  stepProgress,
  storyProgress,
} from '../../src/geometry'

describe('clamp', () => {
  test('passes through the unit interval', () => {
    expect(clamp(0)).toBe(0)
    expect(clamp(0.5)).toBe(0.5)
    expect(clamp(1)).toBe(1)
  })

  test('clamps outside it', () => {
    expect(clamp(-0.1)).toBe(0)
    expect(clamp(1.1)).toBe(1)
  })
})

describe('activeIndex (§5.1: last step whose top has crossed the trigger)', () => {
  const trigger = 400

  test('-1 while no step has crossed', () => {
    expect(activeIndex([600, 1600, 3100], trigger)).toBe(-1)
    expect(activeIndex([], trigger)).toBe(-1)
  })

  test('a top exactly on the trigger line counts as crossed', () => {
    expect(activeIndex([400, 1600], trigger)).toBe(0)
  })

  test('one past the trigger', () => {
    expect(activeIndex([399, 1600, 3100], trigger)).toBe(0)
  })

  test('the last crossed step wins, not the first', () => {
    expect(activeIndex([-1000, 100, 3100], trigger)).toBe(1)
  })

  test('past every step: the final step stays active (§5.1 gap behavior)', () => {
    expect(activeIndex([-3000, -2000, -1000], trigger)).toBe(2)
  })

  test('scan stops at the first uncrossed top — later out-of-order tops never activate', () => {
    // step 1 hasn't crossed; step 2's weird geometry must not make it active
    expect(activeIndex([100, 900, 200], trigger)).toBe(0)
  })
})

describe('storyProgress (§5.2: trigger travel from first top to last bottom)', () => {
  test('0 before the story, 1 after it', () => {
    expect(storyProgress(1600, 4600, 400)).toBe(0)
    expect(storyProgress(-4000, -1000, 400)).toBe(1)
  })

  test('linear in between', () => {
    // trigger 400, span from top 400 → bottom 2400: exactly half way at -600
    expect(storyProgress(-600, 1400, 400)).toBeCloseTo(0.5, 10)
  })

  test('degenerate zero-height span never divides by zero', () => {
    expect(storyProgress(100, 100, 400)).toBe(1) // (400-100)/max(1,0) clamped
    expect(storyProgress(500, 500, 400)).toBe(0)
  })
})

describe('stepProgress (§5.2: chapter runs this top → next top)', () => {
  test('0 at the step top, 1 at the chapter end', () => {
    expect(stepProgress(400, 1400, 400)).toBe(0)
    expect(stepProgress(-600, 400, 400)).toBe(1)
  })

  test('midpoint', () => {
    expect(stepProgress(-100, 900, 400)).toBeCloseTo(0.5, 10)
  })

  test('clamps past the chapter (gap after the last step)', () => {
    expect(stepProgress(-5000, -4000, 400)).toBe(1)
  })

  test('degenerate zero-height chapter never divides by zero', () => {
    expect(stepProgress(100, 100, 400)).toBe(1)
  })
})

describe('chapterProgress (§15.2: 1 passed / stepProgress active / 0 future)', () => {
  const trigger = 400

  test('no active step: every chapter is 0', () => {
    const tops = [600, 1600, 3100]
    const ends = [1600, 3100, 4100]
    expect(chapterProgress(tops, ends, trigger)).toEqual([0, 0, 0])
  })

  test('scrubs through the active chapter; later chapters stay 0', () => {
    // step 0 active (top 300 ≤ trigger, step 1's top 1300 > trigger)
    const tops = [300, 1300, 2800]
    const ends = [1300, 2800, 3800]
    expect(chapterProgress(tops, ends, trigger)).toEqual([0.1, 0, 0])
  })

  test('earlier chapters hold 1 once passed', () => {
    const tops = [-600, 300, 2800]
    const ends = [300, 2800, 3800]
    // step 1 active: (400-300)/(2800-300) = 100/2500 = 0.04
    expect(chapterProgress(tops, ends, trigger)).toEqual([1, 0.04, 0])
  })

  test('last-step case: the last chapter uses its own end, and holds 1 once fully passed', () => {
    const tops = [-1000, -500, 100]
    const ends = [-500, 100, 1100]
    // active is the last step (every top has crossed): (400-100)/1000 = 0.3
    expect(chapterProgress(tops, ends, trigger)).toEqual([1, 1, 0.3])

    const past = [-2000, -1500, -900]
    const pastEnds = [-1500, -900, 100]
    expect(chapterProgress(past, pastEnds, trigger)).toEqual([1, 1, 1])
  })

  test('monotonic non-increasing across steps at any scroll position', () => {
    const tops = [-2500, -1200, 300, 1900]
    const ends = [-1200, 300, 1900, 2900]
    for (const t of [-500, 0, 400, 900, 2000]) {
      const values = chapterProgress(tops, ends, t)
      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBeLessThanOrEqual(values[i - 1] as number)
      }
    }
  })

  test('a pure function of position: the same tops/trigger always reproduce the same output, forward or after scrubbing elsewhere first (exact mirror on reverse)', () => {
    const tops = [-600, 300, 2800]
    const ends = [300, 2800, 3800]
    const before = chapterProgress(tops, ends, trigger)
    // simulate scrolling elsewhere (down past the story, then back up) …
    chapterProgress(tops, ends, 5000)
    chapterProgress(tops, ends, -5000)
    // … the value at the original position is unchanged.
    const after = chapterProgress(tops, ends, trigger)
    expect(after).toEqual(before)
  })
})

describe('interpolateShot (§15.3: the van Wijk–Nuij flight, ρ = √2)', () => {
  // The stage's world-space width, the 4th argument. Everything below that
  // omits it reaches a branch no value of it can influence.
  const W = 1000
  const LONG_PAN = { from: { cx: 0, cy: 0, k: 4 }, to: { cx: 1000, cy: 0, k: 4 } }

  test('a long pan at equal zoom pulls out through its middle instead of sliding flat', () => {
    const mid = interpolateShot(LONG_PAN.from, LONG_PAN.to, 0.5, W)
    expect(mid.cx).toBeCloseTo(500, 9)
    expect(mid.cy).toBeCloseTo(0, 9)
    // View width is w = W/k = 250 at both ends over a pan of d = 1000, so the
    // flight's apex width is √(d² + w²) and k = 1000/√1062500 = 4/√17. ρ = 1
    // would give 4/√5 ≈ 1.789 and any log-space lerp would hold k at 4 — this
    // one number pins the path family AND ρ.
    expect(mid.k).toBeCloseTo(4 / Math.sqrt(17), 4)
    expect(mid.k).toBeCloseTo(0.970143, 4)
  })

  test('pure zoom degenerates to the log-space ramp: no pan distance to trade against', () => {
    const mid = interpolateShot({ cx: 0, cy: 0, k: 1 }, { cx: 0, cy: 0, k: 16 }, 0.5, W)
    expect(mid.k).toBeCloseTo(4, 9)
  })

  test('identical shots return the held shot exactly at every t, with no 0/0', () => {
    const held = { cx: 320, cy: -80, k: 2.5 }
    for (const t of [0, 0.25, 0.5, 1]) {
      expect(interpolateShot(held, { ...held }, t, W)).toEqual(held)
    }
  })

  test('a vanishing pan stays finite at every t — the classic sinh/log blow-up', () => {
    const from = { cx: 0, cy: 0, k: 4 }
    const to = { cx: 1e-9, cy: 0, k: 4 }
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const shot = interpolateShot(from, to, t, W)
      expect(Number.isFinite(shot.cx)).toBe(true)
      expect(Number.isFinite(shot.cy)).toBe(true)
      expect(Number.isFinite(shot.k)).toBe(true)
    }
  })

  test('endpoints stay exact with a world width in play, so a flight never overshoots', () => {
    for (const [t, want] of [
      [0, LONG_PAN.from],
      [1, LONG_PAN.to],
    ] as const) {
      const shot = interpolateShot(LONG_PAN.from, LONG_PAN.to, t, W)
      expect(shot.cx).toBeCloseTo(want.cx, 9)
      expect(shot.cy).toBeCloseTo(want.cy, 9)
      expect(shot.k).toBeCloseTo(want.k, 9)
    }
  })

  // R19: chapter progress maps linearly onto the flight's ARC parameter — the
  // paper's constant-perceived-velocity recommendation — not onto whatever
  // parameter the closed form happens to be written in. That is what makes
  // t = 0.5 the path's midpoint, and its apex for a symmetric flight.
  test('progress is linear in the arc parameter, not in the closed form’s own parameter', () => {
    const at = (t: number) => interpolateShot(LONG_PAN.from, LONG_PAN.to, t, W)

    const early = at(0.25)
    const late = at(0.75)
    expect(early.k).toBeCloseTo(late.k, 6)
    expect(early.cx + late.cx).toBeCloseTo(1000, 6)

    // The flight is a geodesic of zoom-pan space — a circle in (ρ²·cx, w) with
    // w = W/k — so its arc element is √(ρ⁴·dcx² + dw²) / w, and taking w as
    // the geometric mean of an interval's endpoint widths makes the chord
    // exact to ~1e-15 across quarters this coarse. Four equal increments is
    // then a direct statement that equal progress buys equal arc: a flight on
    // the right curve but parameterized by pan distance instead spreads them
    // by ~1.2. (The superseded log-space lerp passes THIS assertion — flat pan
    // at flat zoom is trivially equal-arc — which is why the apex-width case
    // above carries the path family.) The ρ⁴ weight is not decoration:
    // plain √(dcx² + dw²)/w measures a metric this path is NOT a geodesic of
    // and spreads the increments by ~0.3 even when the flight is exact.
    const samples = [0, 0.25, 0.5, 0.75, 1].map(t => {
      const shot = at(t)
      return { cx: shot.cx, w: W / shot.k }
    })
    const increments = samples.slice(1).map((q, i) => {
      const p = samples[i] as { cx: number; w: number }
      return Math.hypot(2 * (q.cx - p.cx), q.w - p.w) / Math.sqrt(p.w * q.w)
    })
    for (const ds of increments) expect(ds).toBeCloseTo(increments[0] as number, 3)
  })

  test('zoom is log-space: equal ratios per unit t, not equal pixels', () => {
    const from = { cx: 0, cy: 0, k: 1 }
    const to = { cx: 0, cy: 0, k: 4 }
    // halfway in log-space between 1 and 4 is sqrt(1*4) = 2, not the linear
    // midpoint 2.5 — log-space is exactly a geometric mean.
    expect(interpolateShot(from, to, 0.5).k).toBeCloseTo(2, 10)
    // a quarter of the way: 1 * (4/1)^0.25 = sqrt(2)
    expect(interpolateShot(from, to, 0.25).k).toBeCloseTo(Math.SQRT2, 10)
  })

  test('endpoints are exact', () => {
    const from = { cx: 12, cy: -4, k: 0.5 }
    const to = { cx: -8, cy: 40, k: 6 }
    expect(interpolateShot(from, to, 0)).toEqual(from)
    expect(interpolateShot(from, to, 1)).toEqual(to)
  })
})

describe('fitZoom (§15.3: default framing — target box at ~70% of the stage)', () => {
  test('scales up a small target to fill 70% of the stage on its tighter axis', () => {
    // target 100x50 in a 1000x1000 stage: width is the tighter axis
    // (1000/100=10 vs 1000/50=20), so k = 0.7 * 10 = 7
    expect(fitZoom(100, 50, 1000, 1000)).toBeCloseTo(7, 10)
  })

  test('non-square target picks whichever axis is tighter', () => {
    // height is tighter here: 1000/200=5 vs 1000/50=20
    expect(fitZoom(50, 200, 1000, 1000)).toBeCloseTo(0.7 * 5, 10)
  })

  test('a target already the size of the stage still frames at 70%, not 100%', () => {
    expect(fitZoom(1000, 1000, 1000, 1000)).toBeCloseTo(0.7, 10)
  })

  test('degenerate zero-size target never divides by zero', () => {
    expect(Number.isFinite(fitZoom(0, 0, 1000, 1000))).toBe(true)
  })
})

describe('cameraTransform (§15.3: compose a shot into a CSS transform)', () => {
  test('centers the shot on the stage center, scaled by k', () => {
    const css = cameraTransform({ cx: 50, cy: 25, k: 2 }, { x: 400, y: 300 })
    expect(css).toBe('translate(400px, 300px) scale(2) translate(-50px, -25px)')
  })
})
