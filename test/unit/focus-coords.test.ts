/*
 * §16 raw-coordinate `data-focus`: the first-character disambiguation and the
 * malformed-coordinate taxonomy, as a pure function. No DOM here on purpose —
 * `parseFocus` is exported precisely so this contract is provable without a
 * browser; what happens to each spec once it reaches the DOM (a box framed,
 * a selector queried, a warn emitted) is e2e's job (e2e/focus-coords.spec.ts
 * and e2e/focus-traps.spec.ts).
 */
import { describe, expect, test } from 'vitest'
import { parseFocus } from '../../src/camera'

describe('parseFocus: a digit or "-" first character takes the coordinate path', () => {
  test('four numbers parse as a box in the camera’s untransformed space', () => {
    expect(parseFocus('120 340 400 300')).toEqual({
      kind: 'box',
      box: { x: 120, y: 340, w: 400, h: 300 },
    })
  })

  test('a negative origin is coordinates, not a selector (the "-" first char)', () => {
    expect(parseFocus('-50 0 200 100')).toEqual({
      kind: 'box',
      box: { x: -50, y: 0, w: 200, h: 100 },
    })
  })
})

describe('parseFocus: anything else takes the selector path, unchanged', () => {
  test('an id selector is passed through verbatim', () => {
    expect(parseFocus('#thing')).toEqual({ kind: 'selector', selector: '#thing' })
  })

  /*
   * The two pinned traps. Both LOOK like coordinates and are not: the rule
   * reads exactly one character, so a leading `.` or `+` is a selector — and
   * an invalid one, which the camera reports as "matches no element" rather
   * than letting `querySelector` throw. Authors write `0.5`, not `.5`.
   * Changing either expectation is a spec change, not a fix.
   */
  test('".5 0 10 10" is a selector (pinned trap: authors write 0.5, not .5)', () => {
    expect(parseFocus('.5 0 10 10')).toEqual({ kind: 'selector', selector: '.5 0 10 10' })
  })

  test('"+50 0 200 100" is a selector (pinned trap: only "-" opts into coordinates)', () => {
    expect(parseFocus('+50 0 200 100')).toEqual({
      kind: 'selector',
      selector: '+50 0 200 100',
    })
  })
})

describe('parseFocus: malformed coordinates are reported, never salvaged', () => {
  test('token count other than four', () => {
    expect(parseFocus('120 340')).toEqual({ kind: 'malformed', value: '120 340' })
    expect(parseFocus('120 340 400')).toEqual({ kind: 'malformed', value: '120 340 400' })
    expect(parseFocus('120 340 400 300 5')).toEqual({
      kind: 'malformed',
      value: '120 340 400 300 5',
    })
  })

  test('a non-finite value', () => {
    expect(parseFocus('120 340 400 NaN')).toEqual({ kind: 'malformed', value: '120 340 400 NaN' })
    expect(parseFocus('120 340 400 30q')).toEqual({ kind: 'malformed', value: '120 340 400 30q' })
  })

  test('a non-positive width or height', () => {
    expect(parseFocus('120 340 -400 300')).toEqual({
      kind: 'malformed',
      value: '120 340 -400 300',
    })
    expect(parseFocus('120 340 400 0')).toEqual({ kind: 'malformed', value: '120 340 400 0' })
  })

  // The rejected alternative (specs: "no point+zoom form"): `x y k` has three
  // tokens, so it lands in `malformed` and is never silently reinterpreted as
  // a framing instruction.
  test('a three-token "x y k" point+zoom form is malformed, not a shot', () => {
    expect(parseFocus('120 340 2')).toEqual({ kind: 'malformed', value: '120 340 2' })
  })
})
