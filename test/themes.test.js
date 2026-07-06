/*
 * S108 — opt-in typography themes (SPEC §2.4 "effects live in CSS" / §6
 * "structural CSS only in the lib; themes are typography/color only").
 *
 * Three layers of proof:
 *  1. Static forbidden-token scan on themes/*.css — no geometry, no at-rules.
 *  2. Semantic scan — serif vs system-ui font stacks, and they differ.
 *  3. Behavioral (real Chrome, index.html) — injecting a theme <link> after
 *     the lib stylesheet changes .step h2/p typography and figure-caption
 *     color, while the sticky figure's structural position never moves.
 *     Run against both themes = the swap proof.
 */
import { test, expect, describe, beforeAll, afterAll } from 'bun:test'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ROOT = `${import.meta.dir}/..`
const INDEX = `file://${ROOT}/index.html`

const THEME_FILES = ['editorial.css', 'system.css']

// Properties/at-rules a typography-only theme must never touch (SPEC §6.1:
// structural CSS — pinning, grid, collapse — is lib-owned). "text-overflow"
// and "line-height" are carved out: they're on the allowed list even though
// they contain a forbidden substring.
const FORBIDDEN_WORDS = [
  'position', 'sticky', 'display', 'grid', 'flex',
  'height', 'z-index', 'transform', 'isolation', 'overflow'
]

const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '')
const stripAllowlisted = css => css
  .replace(/text-overflow/gi, '')
  .replace(/line-height/gi, '')

describe('forbidden-token scan (structural CSS stays lib-only)', () => {
  for (const file of THEME_FILES) {
    test(`themes/${file} has no forbidden geometry tokens`, async () => {
      const raw = await Bun.file(`${ROOT}/themes/${file}`).text()
      const scan = stripAllowlisted(stripComments(raw))
      for (const word of FORBIDDEN_WORDS) {
        const hit = new RegExp(`\\b${word}\\b`, 'i').test(scan)
        expect(hit).toBe(false)
      }
    })

    test(`themes/${file} has no at-rules`, async () => {
      const raw = await Bun.file(`${ROOT}/themes/${file}`).text()
      const scan = stripComments(raw)
      expect(/@[a-zA-Z-]+/.test(scan)).toBe(false)
    })
  }
})

describe('semantic font-stack scan', () => {
  test('editorial.css declares a serif family token', async () => {
    const css = await Bun.file(`${ROOT}/themes/editorial.css`).text()
    expect(/font-family:[^;]*\bserif\b/i.test(css)).toBe(true)
  })

  test('system.css declares system-ui', async () => {
    const css = await Bun.file(`${ROOT}/themes/system.css`).text()
    expect(/font-family:[^;]*\bsystem-ui\b/i.test(css)).toBe(true)
  })

  test('the two stacks differ', async () => {
    const editorial = await Bun.file(`${ROOT}/themes/editorial.css`).text()
    const system = await Bun.file(`${ROOT}/themes/system.css`).text()
    const stack = css => css.match(/\.step h1[^}]*font-family:\s*([^;]+);/)[1]
    expect(stack(editorial)).not.toBe(stack(system))
  })
})

describe('behavioral: theme link injected after the lib stylesheet', () => {
  let browser

  beforeAll(async () => {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  })

  afterAll(async () => {
    await browser?.close()
  })

  const snapshot = async themeFile => {
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 900 })
    await page.goto(INDEX)
    if (themeFile) {
      await page.evaluate(href => new Promise(resolve => {
        const link = document.createElement('link')
        link.rel = 'stylesheet'
        link.href = href
        link.onload = resolve
        document.head.appendChild(link) // after the lib <link> already in <head>
      }), `themes/${themeFile}`)
    }
    const result = await page.evaluate(() => {
      const h2 = document.querySelector('.step h2')
      const p = document.querySelector('.step p')
      const caption = document.querySelector('figure .caption')
      const figure = document.querySelector('.scrolly > figure')
      return {
        h2Font: getComputedStyle(h2).fontFamily,
        pFont: getComputedStyle(p).fontFamily,
        captionColor: getComputedStyle(caption).color,
        figurePosition: getComputedStyle(figure).position
      }
    })
    await page.close()
    return result
  }

  let baseline, editorial, system

  beforeAll(async () => {
    baseline = await snapshot(null)
    editorial = await snapshot('editorial.css')
    system = await snapshot('system.css')
  })

  test('figure stays sticky regardless of theme (structural layer untouched)', () => {
    expect(baseline.figurePosition).toBe('sticky')
    expect(editorial.figurePosition).toBe('sticky')
    expect(system.figurePosition).toBe('sticky')
  })

  for (const [name, themed] of [['editorial', () => editorial], ['system', () => system]]) {
    test(`${name} theme changes h2 font-family vs no theme`, () => {
      expect(themed().h2Font).not.toBe(baseline.h2Font)
    })

    test(`${name} theme changes p font-family vs no theme`, () => {
      expect(themed().pFont).not.toBe(baseline.pFont)
    })

    test(`${name} theme changes figure-caption color vs no theme`, () => {
      expect(themed().captionColor).not.toBe(baseline.captionColor)
    })
  }

  test('swap proof: editorial and system render distinctly from each other', () => {
    expect(editorial.h2Font).not.toBe(system.h2Font)
    expect(editorial.pFont).not.toBe(system.pFont)
    expect(editorial.captionColor).not.toBe(system.captionColor)
  })
})
