/*
 * S108 static layers — SPEC §2.4 "effects live in CSS" / §6 "structural CSS
 * only in the lib; themes are typography/color only".
 *
 *  1. Forbidden-token scan on themes/*.css — no geometry, no at-rules.
 *  2. Semantic scan — serif vs system-ui font stacks, and they differ.
 *
 * The behavioral proof (injecting a theme <link> into index.html changes
 * typography while the figure stays sticky) lives in e2e/themes.spec.ts.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const THEME_FILES = ['editorial.css', 'system.css']
const theme = (f: string) => readFileSync(path.join(import.meta.dirname, '../../themes', f), 'utf8')

// Properties/at-rules a typography-only theme must never touch (SPEC §6.1:
// structural CSS — pinning, grid, collapse — is lib-owned). "text-overflow"
// and "line-height" are carved out: they're on the allowed list even though
// they contain a forbidden substring.
const FORBIDDEN_WORDS = [
  'position',
  'sticky',
  'display',
  'grid',
  'flex',
  'height',
  'z-index',
  'transform',
  'isolation',
  'overflow',
]

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const stripAllowlisted = (css: string) =>
  css.replace(/text-overflow/gi, '').replace(/line-height/gi, '')

describe('forbidden-token scan (structural CSS stays lib-only)', () => {
  for (const file of THEME_FILES) {
    test(`themes/${file} has no forbidden geometry tokens`, () => {
      const scan = stripAllowlisted(stripComments(theme(file)))
      for (const word of FORBIDDEN_WORDS) {
        expect(new RegExp(`\\b${word}\\b`, 'i').test(scan), word).toBe(false)
      }
    })

    test(`themes/${file} has no at-rules`, () => {
      expect(/@[a-zA-Z-]+/.test(stripComments(theme(file)))).toBe(false)
    })
  }
})

describe('semantic font-stack scan', () => {
  test('editorial.css declares a serif family token', () => {
    expect(/font-family:[^;]*\bserif\b/i.test(theme('editorial.css'))).toBe(true)
  })

  test('system.css declares system-ui', () => {
    expect(/font-family:[^;]*\bsystem-ui\b/i.test(theme('system.css'))).toBe(true)
  })

  test('the two stacks differ', () => {
    const stack = (css: string) => css.match(/\.step h1[^}]*font-family:\s*([^;]+);/)?.[1]
    expect(stack(theme('editorial.css'))).toBeDefined()
    expect(stack(theme('editorial.css'))).not.toBe(stack(theme('system.css')))
  })
})
