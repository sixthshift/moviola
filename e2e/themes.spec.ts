/*
 * S108 behavioral proof (SPEC §2.4/§6): injecting a theme <link> after the
 * lib stylesheet in index.html changes .step h2/p typography and the
 * figure-caption color, while the sticky figure's structural position never
 * moves. Run against both themes = the swap proof. The static forbidden-token
 * scans live in test/unit/themes.test.ts.
 */
import { type Browser, expect, test } from '@playwright/test'

const INDEX = `file://${import.meta.dirname}/../index.html`

interface Snapshot {
  h2Font: string
  pFont: string
  captionColor: string
  figurePosition: string
}

const snapshot = async (browser: Browser, themeFile: string | null): Promise<Snapshot> => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  await page.goto(INDEX)
  if (themeFile) {
    await page.evaluate(
      href =>
        new Promise(resolve => {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = href
          link.onload = resolve
          document.head.appendChild(link) // after the lib <link> already in <head>
        }),
      `themes/${themeFile}`
    )
  }
  const result = await page.evaluate(() => {
    const h2 = document.querySelector('.step h2') as HTMLElement
    const p = document.querySelector('.step p') as HTMLElement
    const caption = document.querySelector('figure .caption') as HTMLElement
    const figure = document.querySelector('.scrolly > figure') as HTMLElement
    return {
      h2Font: getComputedStyle(h2).fontFamily,
      pFont: getComputedStyle(p).fontFamily,
      captionColor: getComputedStyle(caption).color,
      figurePosition: getComputedStyle(figure).position,
    }
  })
  await page.close()
  return result
}

let baseline: Snapshot
let editorial: Snapshot
let system: Snapshot

test.beforeAll(async ({ browser }) => {
  baseline = await snapshot(browser, null)
  editorial = await snapshot(browser, 'editorial.css')
  system = await snapshot(browser, 'system.css')
})

test('figure stays sticky regardless of theme (structural layer untouched)', () => {
  expect(baseline.figurePosition).toBe('sticky')
  expect(editorial.figurePosition).toBe('sticky')
  expect(system.figurePosition).toBe('sticky')
})

for (const [name, themed] of [
  ['editorial', () => editorial],
  ['system', () => system],
] as const) {
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
