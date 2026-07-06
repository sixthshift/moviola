/*
 * SPEC §5 math, tested as pure numbers — no browser, no DOM. These are the
 * exact functions Story._update() acts on, so every boundary here is a
 * boundary the state machine has.
 */
import { describe, expect, test } from 'vitest'
import { activeIndex, clamp, stepProgress, storyProgress } from '../../src/geometry'

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
