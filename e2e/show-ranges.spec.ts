/*
 * §16.1 `data-show` ranges, end to end against real Chromium: membership is
 * resolved once at init and then driven through the existing §5.2 `is-shown`
 * toggle, in both traversal directions, plus the two diagnostics a bad range
 * has to produce.
 *
 * Both fixtures embed the built library (marker blocks, `bun run build`) and
 * are plain `file://` pages — what ships is what is asserted here.
 *
 * Scroll geometry is measured from the live DOM (a step's own
 * `getBoundingClientRect` against the root's `data-offset` trigger line, per
 * §5.1) rather than hand-derived pixel constants: the fixtures set step
 * heights in viewport units, so a constant would be a second, drifting copy
 * of the activation rule.
 */
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'

const root = path.join(import.meta.dirname, '..')
const CLEAN = `file://${path.join(root, 'e2e/fixtures-clean/show-ranges.html')}`
const BROKEN = `file://${path.join(root, 'e2e/fixtures-broken/show-ranges-bad.html')}`

/** Scroll so `id`'s top has just crossed the trigger line, then let it settle. */
const settleOn = async (page: Page, id: string) => {
  await page.evaluate(stepId => {
    const step = document.getElementById(stepId) as HTMLElement
    const story = document.getElementById('story') as HTMLElement
    const trigger = window.innerHeight * Number.parseFloat(story.dataset.offset ?? '0.5')
    window.scrollTo(0, step.getBoundingClientRect().top + window.scrollY - trigger + 2)
  }, id)
  await page.waitForFunction(
    stepId => document.getElementById('story')?.getAttribute('data-active-step') === stepId,
    id,
    { timeout: 3000 }
  )
  // two frames: the toggle lands in the step-change batch, the progress vars
  // in the same update (mirrors e2e/zoom-tour.spec.ts's settleTo)
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)))
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)))
}

/** `{ elementId: is-shown }` for every `[data-show]` element in the graphic. */
const membership = (page: Page): Promise<Record<string, boolean>> =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('#story > figure [data-show]')].map(el => [
        el.id,
        el.classList.contains('is-shown'),
      ])
    )
  )

type Console = { warnings: string[]; errors: string[]; pageErrors: string[] }

/** Everything the page said, so a test can assert on what it did NOT say too. */
const recordConsole = (page: Page): Console => {
  const record: Console = { warnings: [], errors: [], pageErrors: [] }
  page.on('console', msg => {
    if (msg.type() === 'warning') record.warnings.push(msg.text())
    if (msg.type() === 'error') record.errors.push(msg.text())
  })
  page.on('pageerror', err => record.pageErrors.push(err.message))
  return record
}

const moviolaWarnings = (record: Console) => record.warnings.filter(w => w.startsWith('moviola:'))

/*
 * The clean fixture: steps a, b, c and one element per well-formed span form.
 *   #open   "b.."   -> b, c
 *   #mixed  "a c.." -> a, c
 *   #all    ".."    -> a, b, c
 *   #upto   "..b"   -> a, b
 *   #closed "a..b"  -> a, b
 */
test.describe('§16.1 data-show ranges drive is-shown', () => {
  test.describe.configure({ mode: 'serial' })

  let page: Page
  let record: Console

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    record = recordConsole(page)
    await page.goto(CLEAN)
  })

  test.afterAll(async () => {
    await page.close()
  })

  test('an open-ended range follows the active step down AND back up', async () => {
    await settleOn(page, 'a')
    expect((await membership(page)).open).toBe(false)

    await settleOn(page, 'b')
    expect((await membership(page)).open).toBe(true)

    await settleOn(page, 'c')
    expect((await membership(page)).open).toBe(true)

    // back up: the toggle is not a one-way latch, and membership resolved at
    // init still applies after the reverse traversal
    await settleOn(page, 'b')
    expect((await membership(page)).open).toBe(true)

    await settleOn(page, 'a')
    expect((await membership(page)).open).toBe(false)
  })

  test('every span form matches the union of the steps it expands to', async () => {
    await settleOn(page, 'a')
    expect(await membership(page)).toEqual({
      open: false,
      mixed: true,
      all: true,
      upto: true,
      closed: true,
    })

    await settleOn(page, 'b')
    expect(await membership(page)).toEqual({
      open: true,
      mixed: false,
      all: true,
      upto: true,
      closed: true,
    })

    await settleOn(page, 'c')
    expect(await membership(page)).toEqual({
      open: true,
      mixed: true,
      all: true,
      upto: false,
      closed: false,
    })
  })

  test('membership is static: a resize mid-story never re-resolves it', async () => {
    await settleOn(page, 'b')
    const before = await membership(page)

    await page.setViewportSize({ width: 900, height: 700 })
    await page.waitForFunction(() => window.innerWidth === 900)
    await settleOn(page, 'b')
    expect(await membership(page)).toEqual(before)

    await page.setViewportSize({ width: 1000, height: 800 })
    await page.waitForFunction(() => window.innerWidth === 1000)
    await settleOn(page, 'b')
    expect(await membership(page)).toEqual(before)
  })

  test('a story of well-formed ranges says nothing on the console', async () => {
    await settleOn(page, 'a')
    await settleOn(page, 'c')
    await settleOn(page, 'a')

    expect(moviolaWarnings(record)).toEqual([])
    expect(record.errors).toEqual([])
    expect(record.pageErrors).toEqual([])
  })
})

/*
 * The broken fixture: `nope..` (endpoint names no step), `c..a` (reversed),
 * and a valid `b` as the fail-soft control. Nothing else in the page can
 * warn, so the counts below are exact.
 */
test.describe('§16.1 data-show range diagnostics', () => {
  test.describe.configure({ mode: 'serial' })

  let page: Page
  let record: Console

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    record = recordConsole(page)
    await page.goto(BROKEN)
    await settleOn(page, 'a')
    await settleOn(page, 'b')
    await settleOn(page, 'c')
    await settleOn(page, 'a')
  })

  test.afterAll(async () => {
    await page.close()
  })

  test('one "matches no step" warn and one "reversed" warn, each prefixed moviola:', async () => {
    const dangling = record.warnings.filter(w => w.includes('matches no step'))
    const reversed = record.warnings.filter(w => w.includes('reversed'))

    expect(dangling).toHaveLength(1)
    expect(reversed).toHaveLength(1)
    expect(dangling[0]).toMatch(/^moviola:/)
    expect(reversed[0]).toMatch(/^moviola:/)
    expect(dangling[0]).toContain('data-show="nope.."')
    expect(reversed[0]).toContain('data-show="c..a"')
    // exactly two diagnostics in total: the range token is never ALSO
    // reported as a dangling bare id, and the reversed span is reported once
    // rather than per endpoint
    expect(moviolaWarnings(record)).toHaveLength(2)
  })

  test('never console.error and never a page error', () => {
    expect(record.errors).toEqual([])
    expect(record.pageErrors).toEqual([])
  })

  test('fail-soft: the bad tokens show nothing, the valid one still transitions', async () => {
    await settleOn(page, 'a')
    expect(await membership(page)).toEqual({ dangling: false, reversed: false, valid: false })

    await settleOn(page, 'b')
    expect(await membership(page)).toEqual({ dangling: false, reversed: false, valid: true })

    await settleOn(page, 'c')
    expect(await membership(page)).toEqual({ dangling: false, reversed: false, valid: false })

    await settleOn(page, 'b')
    expect(await membership(page)).toEqual({ dangling: false, reversed: false, valid: true })
  })

  test('each diagnostic stays at one warn across repeated traversals and a resize', async () => {
    await page.setViewportSize({ width: 900, height: 700 })
    await page.waitForFunction(() => window.innerWidth === 900)
    await settleOn(page, 'b')
    await settleOn(page, 'c')

    await page.setViewportSize({ width: 1000, height: 800 })
    await page.waitForFunction(() => window.innerWidth === 1000)
    await settleOn(page, 'a')
    await settleOn(page, 'c')

    expect(record.warnings.filter(w => w.includes('matches no step'))).toHaveLength(1)
    expect(record.warnings.filter(w => w.includes('reversed'))).toHaveLength(1)
    expect(moviolaWarnings(record)).toHaveLength(2)
  })
})
