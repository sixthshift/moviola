/*
 * §16 named framings as pure numbers: `fitZoom`'s fit fraction, and the table
 * each `data-shot` name is calibrated to — wide 0.50 · medium 0.70 ·
 * close 0.90.
 *
 * The stage is 1000×500 against a 100×100 subject, so the tighter axis is the
 * height: min(10, 5) = 5, and every expectation is `fraction × 5`. That
 * asymmetry is deliberate — a fraction applied to the wrong axis, or a fit
 * that stopped taking the tighter one, lands on 10 × fraction and is visible
 * here rather than only in a browser.
 *
 * Name → fraction resolution itself is DOM-side (src/camera.ts, where
 * `data-shot` is read); the runtime path from an authored name to a settled
 * transform is pinned by e2e/shot-framings.spec.ts. This file pins the
 * arithmetic each fraction must produce, and that the parameter is optional.
 */
import { describe, expect, test } from 'vitest'
import { fitZoom } from '../../src/geometry'

// The one geometry every case below shares: subject w/h, then stage w/h.
const fitTo = (fraction: number) => fitZoom(100, 100, 1000, 500, fraction)

describe('fitZoom fit fraction (§16 data-shot framings)', () => {
  test('wide (0.50) fits the subject to half the tighter axis', () => {
    expect(fitTo(0.5)).toBeCloseTo(2.5, 10)
  })

  test('medium (0.70)', () => {
    expect(fitTo(0.7)).toBeCloseTo(3.5, 10)
  })

  test('close (0.90)', () => {
    expect(fitTo(0.9)).toBeCloseTo(4.5, 10)
  })

  test('the fractions are ordered as the names read, against one subject', () => {
    expect(fitTo(0.5)).toBeLessThan(fitTo(0.7))
    expect(fitTo(0.7)).toBeLessThan(fitTo(0.9))
  })

  test('the four-argument call is medium — no attribute cannot reframe a story', () => {
    expect(fitZoom(100, 100, 1000, 500)).toBeCloseTo(3.5, 10)
    // Bit-exact, not close: an absent `data-shot` and `data-shot="medium"`
    // are the same framing, so they must be the same number.
    expect(fitZoom(100, 100, 1000, 500)).toBe(fitTo(0.7))
  })

  test('an unresolved name is the absent fraction, never NaN', () => {
    // What src/camera.ts hands over for a name its table does not carry: the
    // fit default, which is what keeps an unknown name a framing decision
    // rather than a broken transform.
    expect(fitZoom(100, 100, 1000, 500, undefined)).toBe(fitZoom(100, 100, 1000, 500))
  })

  test('a degenerate zero-size subject still guards, at every fraction', () => {
    // max(1, …) holds under the parameter: the fraction scales the guarded
    // fit, it does not bypass it.
    expect(fitZoom(0, 0, 1000, 500, 0.5)).toBeCloseTo(250, 10)
    expect(fitZoom(0, 0, 1000, 500)).toBeCloseTo(350, 10)
  })
})
