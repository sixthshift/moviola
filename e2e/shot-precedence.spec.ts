/*
 * §16 + §15.6 the two `data-shot` diagnostics, end to end against real
 * Chromium — each one paired with the silent control that makes its resolved
 * value falsifiable:
 *
 *  - fixtures-broken/shot-conflict.html — `data-shot="close" data-zoom="2"` on
 *    one step settles at 2 (the number outranks the name) while a sibling
 *    focusing the SAME subject with `data-shot="close"` alone settles on the
 *    close fit instead. Pinning the conflicted step to 2 and the sibling away
 *    from it is what rules out the losing implementations: a name that won, a
 *    name and a number blended, or a `data-zoom` that only happened to look
 *    right because both steps framed identically.
 *  - fixtures-broken/shot-unknown.html — `data-shot="extreme"` settles at the
 *    same transform as an attribute-less step focusing the same subject, which
 *    is the fit default (0.70, `medium`'s own fraction). Equality against a
 *    control needs no hand-derived constant, and it is the honest statement of
 *    the fallback: the unknown name resolves to nothing, so nothing about the
 *    framing changes.
 *
 * Both pages must report their mistake exactly once — through `console.warn`,
 * never `console.error` — and must keep working: the counts are re-asserted
 * after a viewport resize, which re-measures every shot (§5.3) and so re-runs
 * both diagnostics' code paths through the warn-once channel.
 *
 * The measurement choices mirror e2e/shot-framings.spec.ts: the camera's
 * RESOLVED matrix via `DOMMatrixReadOnly` (what the browser actually applied,
 * as a number, not the authored `--camera-transform` string), sampled at each
 * chapter's OWN start (t = 0), where the transform equals that chapter's own
 * shot under any interpolation.
 *
 * Both fixtures embed the built library (marker blocks, `bun run build`) and
 * are plain `file://` pages — what ships is what is asserted here.
 */
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'

const fixture = (name: string) =>
  `file://${path.join(import.meta.dirname, 'fixtures-broken', name)}`

type Geometry = { ids: string[]; tops: number[]; trigger: number }

const chapterGeometry = (page: Page): Promise<Geometry> =>
  page.evaluate(() => {
    const story = document.getElementById('story') as HTMLElement
    const offset = Number.parseFloat(story.dataset.offset ?? '0.5')
    const steps = [...story.querySelectorAll(':scope > .step')] as HTMLElement[]
    return {
      ids: steps.map(s => s.id),
      tops: steps.map(s => s.getBoundingClientRect().top + window.scrollY),
      trigger: window.innerHeight * offset,
    }
  })

/*
 * A chapter boundary activates the LATER step (§5.1 activates on the trigger
 * reaching a step's top), so a "t = 0" sample is taken a hair past the top it
 * names to make the intended chapter unambiguously active. Both fixtures run
 * two viewports per chapter, so that hair is ~1/1600 of the span — worth under
 * 2e-3 on the conflicted step's magnification, against the 1e-2 bar below.
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

type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number }

/**
 * The matrix the browser is actually applying to `[data-camera]`. The camera
 * composes to translate · uniform scale · translate, so `a` is the
 * magnification — asserted rotation- and skew-free here rather than assumed,
 * since reading `a` that way is only true of that shape.
 */
const cameraMatrix = async (page: Page): Promise<Matrix> => {
  const m = await page.evaluate(() => {
    const camera = document.querySelector('[data-camera]') as SVGGraphicsElement
    const matrix = new DOMMatrixReadOnly(getComputedStyle(camera).transform)
    return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, e: matrix.e, f: matrix.f }
  })
  expect(m.b).toBe(0)
  expect(m.c).toBe(0)
  expect(m.d).toBeCloseTo(m.a, 6)
  return m
}

/** The nudge's worth of flight, rounded up — see NUDGE. */
const TOLERANCE = 0.01

/**
 * The sibling's own fit has to be far from the authored zoom for "not 2" to
 * mean anything; in shot-conflict.html's geometry the close fit is several
 * times it, so this margin is loose on purpose — it fails a runtime that let
 * the name and the number blend, without pinning the fixture's own stage box.
 */
const SEPARATION = 0.5

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

const scrollyWarnings = (record: Console) => record.warnings.filter(w => w.startsWith('scrolly:'))

/** Re-measures every shot (§5.3) — the path a warn-once channel must survive. */
const resizeAndResettle = async (page: Page, i: number): Promise<Geometry> => {
  await page.setViewportSize({ width: 900, height: 700 })
  // Chapter tops move with the viewport, so the geometry the settle needs is
  // the re-measured one, never the caller's pre-resize copy.
  const resized = await chapterGeometry(page)
  await settleAtChapterStart(page, resized, i)
  return resized
}

test.describe('§16 an explicit data-zoom outranks a named framing, and the name is reported', () => {
  test.describe.configure({ mode: 'serial' })

  let page: Page
  let geo: Geometry
  let record: Console

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    record = recordConsole(page)
    await page.goto(fixture('shot-conflict.html'))
    geo = await chapterGeometry(page)
    expect(geo.ids).toEqual(['conflict', 'shot-only'])
  })

  test.afterAll(async () => {
    await page.close()
  })

  test('the conflicted step settles at the authored data-zoom, not the close fit', async () => {
    await settleAtChapterStart(page, geo, 0)
    const { a: scale } = await cameraMatrix(page)

    expect(Math.abs(scale - 2)).toBeLessThanOrEqual(TOLERANCE)
  })

  test('the data-shot-only sibling on the same subject settles elsewhere', async () => {
    await settleAtChapterStart(page, geo, 1)
    const { a: scale } = await cameraMatrix(page)

    // A camera that never wrote a transform reads 1 on both sides, so the
    // inequality alone would pass on a story whose shots never resolved.
    expect(scale).toBeGreaterThan(0)
    expect(Math.abs(scale - 2)).toBeGreaterThan(SEPARATION)
  })

  test('the co-presence is reported exactly once, and a resize does not repeat it', async () => {
    geo = await resizeAndResettle(page, 0)
    const { a: scale } = await cameraMatrix(page)

    // The explicit zoom is a magnification, not a fit: the resize that reframes
    // the sibling leaves the conflicted step exactly where it was authored.
    expect(Math.abs(scale - 2)).toBeLessThanOrEqual(TOLERANCE)
    expect(scrollyWarnings(record)).toHaveLength(1)
    expect(scrollyWarnings(record)[0]).toContain('data-shot="close"')
    expect(scrollyWarnings(record)[0]).toContain('data-zoom="2"')
  })

  test('the page never errored and kept transitioning', () => {
    expect(record.errors).toEqual([])
    expect(record.pageErrors).toEqual([])
  })
})

test.describe('§16 an unknown data-shot name falls back to the fit default, and is reported', () => {
  test.describe.configure({ mode: 'serial' })

  let page: Page
  let geo: Geometry
  let record: Console

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    record = recordConsole(page)
    await page.goto(fixture('shot-unknown.html'))
    geo = await chapterGeometry(page)
    expect(geo.ids).toEqual(['unknown', 'unnamed'])
  })

  test.afterAll(async () => {
    await page.close()
  })

  test('the invented name frames exactly as the attribute-less step does', async () => {
    await settleAtChapterStart(page, geo, 0)
    const unknown = await cameraMatrix(page)
    await settleAtChapterStart(page, geo, 1)
    const unnamed = await cameraMatrix(page)

    // Identity is what an unresolved camera leaves behind, and two identities
    // would match each other — so the framing has to be a real one first.
    expect(unknown.a).toBeGreaterThan(1)
    expect(unknown.a).toBeCloseTo(unnamed.a, 6)
    expect(unknown.e).toBeCloseTo(unnamed.e, 6)
    expect(unknown.f).toBeCloseTo(unnamed.f, 6)
  })

  test('the unknown name is reported exactly once, and a resize does not repeat it', async () => {
    geo = await resizeAndResettle(page, 0)
    const after = await cameraMatrix(page)

    // Still framed, still by the fallback: the resize reframes both chapters
    // together, so they stay equal to each other.
    expect(after.a).toBeGreaterThan(1)
    await settleAtChapterStart(page, geo, 1)
    expect((await cameraMatrix(page)).a).toBeCloseTo(after.a, 6)

    expect(scrollyWarnings(record)).toHaveLength(1)
    expect(scrollyWarnings(record)[0]).toContain('data-shot="extreme"')
  })

  test('the page never errored and kept transitioning', () => {
    expect(record.errors).toEqual([])
    expect(record.pageErrors).toEqual([])
  })
})
