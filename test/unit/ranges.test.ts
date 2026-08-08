/*
 * SPEC §16.1 `data-show` range grammar, tested as the pure resolver — no DOM,
 * no warn channel. These are the exact tokens an author types, resolved
 * against the exact step keys Story hands over (`stepId`: the real id, or the
 * numeric-index fallback), so every fixture here is an authoring case.
 */
import { describe, expect, test } from 'vitest'
import { resolveShow } from '../../src/geometry'

const STEPS = ['intro', 'crash', 'recovery', 'epilogue']

// The caller splits on whitespace and drops empties, so the resolver never
// sees an empty token — these helpers mirror that contract, not re-implement it.
const shown = (value: string, stepKeys: readonly string[] = STEPS) => [
  ...resolveShow(value.split(/\s+/).filter(Boolean), stepKeys).keys,
]
const issues = (value: string, stepKeys: readonly string[] = STEPS) =>
  resolveShow(value.split(/\s+/).filter(Boolean), stepKeys).issues

describe('resolveShow spans (§16.1: the four forms, inclusive at both ends)', () => {
  test('`a..` runs the named step through the last', () => {
    expect(shown('crash..')).toEqual(['crash', 'recovery', 'epilogue'])
    expect(issues('crash..')).toEqual([])
  })

  test('`..a` runs the first step through the named one, inclusive', () => {
    expect(shown('..crash')).toEqual(['intro', 'crash'])
    expect(issues('..crash')).toEqual([])
  })

  test('`a..b` is inclusive at both ends', () => {
    expect(shown('crash..recovery')).toEqual(['crash', 'recovery'])
    expect(issues('crash..recovery')).toEqual([])
  })

  test('bare `..` is every step (which omitting data-show is NOT)', () => {
    expect(shown('..')).toEqual(STEPS)
    expect(issues('..')).toEqual([])
  })

  test('a single step named at both ends is that one step', () => {
    expect(shown('crash..crash')).toEqual(['crash'])
    expect(issues('crash..crash')).toEqual([])
  })
})

describe('resolveShow bare tokens (§16.1: the pre-range behavior, unchanged)', () => {
  test('a bare id resolves to itself', () => {
    expect(shown('crash')).toEqual(['crash'])
    expect(issues('crash')).toEqual([])
  })

  test('a bare token matching no step is the original dangling diagnostic', () => {
    expect(shown('nope')).toEqual([])
    expect(issues('nope')).toEqual([{ token: 'nope', reason: 'no-step' }])
  })
})

describe('resolveShow values (§16.1: a space-separated list, resolved as a union)', () => {
  test('mixed forms union together', () => {
    expect(shown('intro epilogue..')).toEqual(['intro', 'epilogue'])
    expect(issues('intro epilogue..')).toEqual([])
  })

  test('overlapping tokens contribute a step once (a set, not a bag)', () => {
    // Compared as a set: the union covers every step, and the resolver hands
    // back keys, not occurrences — `crash` is in both tokens and appears once.
    expect(shown('crash.. ..recovery')).toHaveLength(STEPS.length)
    expect(new Set(shown('crash.. ..recovery'))).toEqual(new Set(STEPS))
  })

  test('one bad token never suppresses the good ones beside it', () => {
    expect(shown('nope.. crash')).toEqual(['crash'])
    expect(issues('nope.. crash')).toEqual([{ token: 'nope..', reason: 'no-step' }])
  })
})

describe('resolveShow diagnostics (§16.1: distinct reasons for distinct mistakes)', () => {
  test('a reversed span resolves to nothing and is reported as reversed', () => {
    expect(shown('recovery..crash')).toEqual([])
    expect(issues('recovery..crash')).toEqual([{ token: 'recovery..crash', reason: 'reversed' }])
  })

  test('a reversed span is NEVER silently normalized into its forward twin', () => {
    // The author's misunderstanding of their own step order has to surface;
    // matching the forward span's output would hide it behind working pixels.
    expect(shown('recovery..crash')).not.toEqual(shown('crash..recovery'))
    expect(issues('crash..recovery')).toEqual([])
  })

  test('a dangling endpoint resolves to nothing, on either side', () => {
    expect(shown('nope..')).toEqual([])
    expect(issues('nope..')).toEqual([{ token: 'nope..', reason: 'no-step' }])
    expect(shown('..nope')).toEqual([])
    expect(issues('..nope')).toEqual([{ token: '..nope', reason: 'no-step' }])
    expect(shown('intro..nope')).toEqual([])
    expect(issues('intro..nope')).toEqual([{ token: 'intro..nope', reason: 'no-step' }])
  })

  test('a token carrying `..` but matching no form shares the dangling disposition', () => {
    for (const token of ['a..b..c', '...', 'a....b']) {
      expect(shown(token)).toEqual([])
      expect(issues(token)).toEqual([{ token, reason: 'no-step' }])
    }
  })

  test('exactly one issue per bad token, never one per step it failed to match', () => {
    expect(issues('nope.. recovery..crash')).toHaveLength(2)
  })
})

describe('resolveShow key identity (§16.1: expansion covers index-fallback keys)', () => {
  test('a step keyed by its index is a range member like any other', () => {
    expect(shown('crash..', ['0', 'crash', '2'])).toEqual(['crash', '2'])
    expect(issues('crash..', ['0', 'crash', '2'])).toEqual([])
  })

  test('an index-fallback key is addressable as an endpoint too', () => {
    expect(shown('0..crash', ['0', 'crash', '2'])).toEqual(['0', 'crash'])
    expect(shown('..2', ['0', 'crash', '2'])).toEqual(['0', 'crash', '2'])
  })

  test('a story with no steps yields no keys and reports the open end as dangling', () => {
    expect(shown('..', [])).toEqual([])
    expect(issues('..', [])).toEqual([{ token: '..', reason: 'no-step' }])
  })
})
