/*
 * SPEC §5 math, tested as pure numbers — no browser, no DOM. These are the
 * exact functions Story._update() acts on, so every boundary here is a
 * boundary the state machine has.
 */
import { describe, expect, test } from 'vitest'
import {
  activeIndex,
  chapterProgress,
  clamp,
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
