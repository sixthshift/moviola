/*
 * SPEC §3 hard bars: ≤ 4 KB gzipped JS, ≤ 2 KB gzipped CSS — measured on the
 * artifacts consumers actually load. Requires a fresh `bun run build`.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'

const dist = (f: string) => readFileSync(path.join(import.meta.dirname, '../../dist', f))
const gzipped = (f: string) => gzipSync(dist(f)).length

describe('SPEC §3 size budget', () => {
  test('dist/scrolly.iife.js ≤ 4096 B gzipped', () => {
    expect(gzipped('scrolly.iife.js')).toBeLessThanOrEqual(4096)
  })

  test('dist/scrolly.min.js ≤ 4096 B gzipped', () => {
    expect(gzipped('scrolly.min.js')).toBeLessThanOrEqual(4096)
  })

  test('dist/scrolly.css ≤ 2048 B gzipped', () => {
    expect(gzipped('scrolly.css')).toBeLessThanOrEqual(2048)
  })

  test('min build is genuinely smaller than the readable iife', () => {
    expect(dist('scrolly.min.js').length).toBeLessThan(dist('scrolly.iife.js').length)
  })
})
