/*
 * SPEC §3 hard bars: ≤ 4.5 KB gzipped JS (v0.5 change order CO-1; was 4 KB), ≤ 2 KB gzipped CSS — measured on the
 * artifacts consumers actually load. Requires a fresh `bun run build`.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'

const dist = (f: string) => readFileSync(path.join(import.meta.dirname, '../../dist', f))
const gzipped = (f: string) => gzipSync(dist(f)).length

describe('SPEC §3 size budget', () => {
  test('dist/scrolly.min.js ≤ 4608 B gzipped', () => {
    expect(gzipped('scrolly.min.js')).toBeLessThanOrEqual(4608)
  })

  test('dist/scrolly.css ≤ 2048 B gzipped', () => {
    expect(gzipped('scrolly.css')).toBeLessThanOrEqual(2048)
  })
})
