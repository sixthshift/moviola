/*
 * §16 `data-shot` named framings, end to end against real Chromium: two
 * chapters focusing the SAME subject, one `data-shot="wide"` and one
 * `data-shot="close"`, must settle at magnifications whose ratio is exactly
 * the ratio of the pinned fractions — 0.90 / 0.50 = 1.8.
 *
 * The RATIO is the assertion, not the two magnifications. It is independent of
 * the fixture's stage geometry (viewport, viewBox, the subject's own size all
 * cancel), so it needs no hand-derived pixel constants; and unlike "close is
 * tighter than wide" it cannot be satisfied by any fraction pair but the
 * pinned one — a plausible-looking decoy (0.4/0.8, or names swapped onto the
 * wrong fractions) fails it.
 *
 * Two measurement choices carry the test:
 *
 *  - The camera's RESOLVED matrix, via `DOMMatrixReadOnly`, rather than the
 *    `--camera-transform` string: the scale is what the browser actually
 *    applied, read as a number, not as authored text.
 *  - Each chapter is sampled at its OWN start (t = 0), where the transform
 *    equals that chapter's own shot under any interpolation — so the numbers
 *    compared are the two authored framings and not two points on a flight.
 *
 * The fixture embeds the built library (marker blocks, `bun run build`) and is
 * a plain `file://` page — what ships is what is asserted here.
 */
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'

const FIXTURE = `file://${path.join(import.meta.dirname, 'fixtures-clean/shot-framings.html')}`

/** wide 0.50 · close 0.90, per the pinned §16 table. */
const RATIO = 0.9 / 0.5
const TOLERANCE = 0.01

type Geometry = { ids: string[]; tops: number[]; lastBottom: number; trigger: number }

const chapterGeometry = (page: Page): Promise<Geometry> =>
  page.evaluate(() => {
    const story = document.getElementById('story') as HTMLElement
    const offset = Number.parseFloat(story.dataset.offset ?? '0.5')
    const steps = [...story.querySelectorAll(':scope > .step')] as HTMLElement[]
    const last = steps[steps.length - 1] as HTMLElement
    return {
      ids: steps.map(s => s.id),
      tops: steps.map(s => s.getBoundingClientRect().top + window.scrollY),
      lastBottom: last.getBoundingClientRect().bottom + window.scrollY,
      trigger: window.innerHeight * offset,
    }
  })

/*
 * A chapter boundary activates the LATER step (§5.1 activates on the trigger
 * reaching a step's top), so a "t = 0" sample is taken a hair past the top it
 * names to make the intended chapter unambiguously active. `wide`'s chapter
 * flies, so that hair moves its magnification: at two viewports per chapter it
 * is ~1/1600 of the span, worth ~4e-4 on the ratio against the 1e-2 bar.
 */
const NUDGE = 1

const settleAtChapterStart = async (page: Page, geo: Geometry, i: number): Promise<void> => {
  await page.evaluate(
    y => window.scrollTo(0, Math.max(0, y)),
    (geo.tops[i] as number) - geo.trigger + NUDGE
  )
  await page.waitForFunction(
    id => document.getElementById('story')?.getAttribute('data-active-step') === id,
    geo.ids[i] as string,
    { timeout: 3000 }
  )
  // two frames: the step-change batch, then the same-update progress write
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)))
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)))
}

/**
 * The magnification the browser is actually applying to `[data-camera]`. The
 * camera composes to translate · uniform scale · translate, so the scale is
 * `a` — asserted rotation- and skew-free here rather than assumed, since
 * reading `a` as "the scale" is only true of that shape.
 */
const cameraScale = async (page: Page): Promise<number> => {
  const m = await page.evaluate(() => {
    const camera = document.querySelector('[data-camera]') as SVGGraphicsElement
    const matrix = new DOMMatrixReadOnly(getComputedStyle(camera).transform)
    return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d }
  })
  expect(m.b).toBe(0)
  expect(m.c).toBe(0)
  expect(m.d).toBeCloseTo(m.a, 6)
  return m.a
}

type Console = { warnings: string[]; errors: string[]; pageErrors: string[] }

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

test.describe('§16 data-shot resolves to the pinned fit fractions in the browser', () => {
  test.describe.configure({ mode: 'serial' })

  let page: Page
  let geo: Geometry
  let record: Console

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    record = recordConsole(page)
    await page.goto(FIXTURE)
    geo = await chapterGeometry(page)
    expect(geo.ids).toEqual(['wide', 'close'])
  })

  test.afterAll(async () => {
    await page.close()
  })

  test('close : wide is 0.90 / 0.50 on the settled transform', async () => {
    await settleAtChapterStart(page, geo, 0)
    const wide = await cameraScale(page)
    await settleAtChapterStart(page, geo, 1)
    const close = await cameraScale(page)

    // Both framings resolved at all: a camera that never wrote a transform
    // would read 1 on both sides and divide to a passing-looking 1.
    expect(wide).toBeGreaterThan(0)
    expect(close).toBeGreaterThan(wide)

    expect(Math.abs(close / wide - RATIO)).toBeLessThanOrEqual(TOLERANCE)
  })

  test('the ratio is the same read in the other direction', async () => {
    // Re-measured after a reverse traversal: shots re-resolve on step change
    // (§5.3), and a named framing must not depend on how it was arrived at.
    await settleAtChapterStart(page, geo, 1)
    const close = await cameraScale(page)
    await settleAtChapterStart(page, geo, 0)
    const wide = await cameraScale(page)

    expect(Math.abs(close / wide - RATIO)).toBeLessThanOrEqual(TOLERANCE)
  })

  test('a story of well-formed shot names says nothing on the console', () => {
    expect(moviolaWarnings(record)).toEqual([])
    expect(record.errors).toEqual([])
    expect(record.pageErrors).toEqual([])
  })
})
