/*
 * §15.6 structure diagnostics, end to end against real Chromium: the three
 * markup shapes that leave a story silently inert each say exactly one thing,
 * and the two shapes that only *look* broken say nothing at all.
 *
 * Every fixture embeds the built library (marker blocks, `bun run build`) and
 * is a plain `file://` page, so what ships is what is asserted here. Each is
 * loaded once, scrolled top to bottom, and judged on the whole console
 * transcript — a diagnostic that fires twice, or a second diagnostic riding
 * along behind the intended one, fails the count.
 *
 * The counts are exact because each fixture is built to have exactly one
 * thing wrong with it: nothing else in any of these pages can warn.
 */
import path from 'node:path'
import { type Browser, expect, test } from '@playwright/test'

const root = path.join(import.meta.dirname, '..')

const FIXTURES = {
  nested: 'e2e/fixtures-broken/structure-nested-steps.html',
  noSteps: 'e2e/fixtures-broken/structure-no-steps.html',
  cameraNoFigure: 'e2e/fixtures-broken/structure-camera-no-figure.html',
  proseOnly: 'e2e/fixtures-clean/structure-prose-only.html',
  scrubNoFigure: 'e2e/fixtures-clean/structure-scrub-no-figure.html',
} as const

type Visit = {
  /** `scrolly:`-prefixed console warnings, in the order they were printed. */
  warnings: string[]
  errors: string[]
  pageErrors: string[]
  /** §15.1.6 fail-soft: the runtime still finished its init pass. */
  isReady: boolean
}

/** Load a fixture, scroll it through once, and report everything it said. */
const visit = async (browser: Browser, rel: string): Promise<Visit> => {
  const page = await (await browser.newContext()).newPage()
  const warnings: string[] = []
  const errors: string[] = []
  const pageErrors: string[] = []
  page.on('console', msg => {
    if (msg.type() === 'warning' && msg.text().startsWith('scrolly:')) warnings.push(msg.text())
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', err => pageErrors.push(err.message))

  await page.goto(`file://${path.join(root, rel)}`)

  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  const samples = 16
  for (let i = 0; i <= samples; i++) {
    await page.evaluate(y => window.scrollTo(0, y), Math.round((height * i) / samples))
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)))
  }

  const isReady = await page.evaluate(
    () => document.querySelector('.scrolly')?.classList.contains('is-ready') === true
  )
  await page.close()
  return { warnings, errors, pageErrors, isReady }
}

test.describe('§15.6 structure diagnostics', () => {
  test.describe.configure({ mode: 'serial' })

  const visits = {} as Record<keyof typeof FIXTURES, Visit>

  test.beforeAll(async ({ browser }) => {
    for (const [key, rel] of Object.entries(FIXTURES)) {
      visits[key as keyof typeof FIXTURES] = await visit(browser, rel)
    }
  })

  test('nested steps: one warn naming the count and "direct children"', () => {
    const { warnings } = visits.nested
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('direct children')
    // the count is the diagnostic's whole payload — an author with three
    // wrapped steps must be told three were found, not just "some"
    expect(warnings[0]).toContain('3')
  })

  test('no steps at all: one warn, and not the nested-steps message', () => {
    const { warnings } = visits.noSteps
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).not.toContain('direct children')
    // the two branches of the same emptiness check must stay tellable apart
    expect(warnings[0]).not.toEqual(visits.nested.warnings[0])
  })

  test('a camera with no figure: one warn about the missing frame', () => {
    const { warnings } = visits.cameraNoFigure
    // with no figure the rig never resolves, so the camera's own "no
    // data-focus anywhere" diagnostic cannot fire behind this one
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/^scrolly:/)
  })

  test('a prose-only story with no figure says nothing', () => {
    expect(visits.proseOnly.warnings).toEqual([])
  })

  test('a data-scrub-only story with no figure says nothing', () => {
    // [data-scrub] is deliberately excluded from the figure diagnostic: scrub
    // attaches to any element and works figure-free by design
    expect(visits.scrubNoFigure.warnings).toEqual([])
  })

  test('every diagnostic fails soft: is-ready is stamped and nothing throws', () => {
    for (const key of Object.keys(FIXTURES) as Array<keyof typeof FIXTURES>) {
      expect(visits[key].isReady, `${FIXTURES[key]} is-ready`).toBe(true)
      expect(visits[key].pageErrors, `${FIXTURES[key]} page errors`).toEqual([])
      expect(visits[key].errors, `${FIXTURES[key]} console errors`).toEqual([])
    }
  })
})
