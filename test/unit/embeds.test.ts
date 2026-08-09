/*
 * The byte-identity chain: dist/moviola.min.js is the canonical build, and
 * every embedded copy of the library — the marker blocks in examples/*.html
 * and the files in skill/assets/ — must match it exactly. The §14 validator
 * identifies "the lib" inside a page by byte-equality with
 * dist/moviola.min.js, so any drift here silently breaks tier
 * classification. `bun run build` re-syncs.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const root = path.join(import.meta.dirname, '../..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')

const distCss = read('dist/moviola.css')
const distJs = read('dist/moviola.min.js')

const extract = (html: string, mark: string, tag: string): string => {
  const m = html.match(
    new RegExp(`<!-- ${mark} -->\\n<${tag}>([^]*?)</${tag}>\\n<!-- /${mark} -->`)
  )
  if (!m) throw new Error(`no well-formed ${mark} block`)
  return m[1] as string
}

// Every dir whose HTML embeds the lib between markers (same list as
// scripts/sync-embeds.mjs): the gallery plus the validator's fixtures —
// they get copied to random temp paths, so they must be self-contained.
const EMBED_DIRS = ['examples', 'e2e/fixtures-broken', 'e2e/fixtures-clean']

describe('marker blocks embed the built library byte-identically', () => {
  test('all seven examples are present', () => {
    expect(readdirSync(path.join(root, 'examples')).filter(f => f.endsWith('.html'))).toHaveLength(
      7
    )
  })

  for (const dir of EMBED_DIRS) {
    for (const name of readdirSync(path.join(root, dir)).filter(f => f.endsWith('.html'))) {
      test(`${dir}/${name}`, () => {
        const html = read(`${dir}/${name}`)
        expect(extract(html, 'moviola:css', 'style')).toBe(distCss)
        expect(extract(html, 'moviola:js', 'script')).toBe(distJs)
      })
    }
  }
})

describe('skill assets mirror dist', () => {
  test('skill/assets/moviola.js ≡ dist/moviola.min.js', () => {
    expect(read('skill/assets/moviola.js')).toBe(distJs)
  })

  test('skill/assets/moviola.css ≡ dist/moviola.css', () => {
    expect(read('skill/assets/moviola.css')).toBe(distCss)
  })
})
