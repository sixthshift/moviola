/*
 * §16 raw-coordinate `data-focus`, end to end against real Chromium: a
 * coordinate box is the shot's subject exactly as a selector's measured bbox
 * is (equal framing, equal `data-zoom` override), and a malformed coordinate
 * list holds instead of framing — mid-story it holds the shot already
 * arrived at, and on the first shot there is nothing to hold, so no
 * `--camera-transform` is written at all.
 *
 * All three fixtures embed the built library (marker blocks, `bun run build`)
 * and are plain `file://` pages — what ships is what is asserted here.
 *
 * Two measurement choices are load-bearing:
 *
 *  - The camera's RESOLVED matrix is read via `DOMMatrixReadOnly`, never the
 *    `--camera-transform` string: the two forms reach the same framing
 *    through different arithmetic (a literal box vs. inverse-CTM bbox math),
 *    so they agree to float tolerance and not to the character.
 *  - A chapter is sampled through the shot it FRAMES — scale plus the focus
 *    center recovered from the matrix against an independently derived stage
 *    center — rather than through raw `e`/`f`. `cx`/`cy` are then directly
 *    comparable with the numbers the fixture authored.
 *
 * Geometry is measured from the live DOM (each step's own
 * `getBoundingClientRect` against the root's `data-offset` trigger line, per
 * §5.1/§5.2) rather than hand-derived pixel constants.
 */
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'

const root = path.join(import.meta.dirname, '..')
const CLEAN = `file://${path.join(root, 'e2e/fixtures-clean/focus-coords.html')}`
const MID = `file://${path.join(root, 'e2e/fixtures-broken/focus-coords-mid.html')}`
const FIRST = `file://${path.join(root, 'e2e/fixtures-broken/focus-coords-first.html')}`

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
 * reaching a step's top), so every sample is taken a hair past the boundary
 * it names: at `t = 0` that makes the intended chapter unambiguously active,
 * and at `t = 1` it makes the next one active — which is the same instant.
 * The consequence is that a "t = 0" sample sits at 2px/span into the chapter
 * rather than at exactly 0, so a chapter that FLIES has drifted a hair off
 * its start shot; the assertions below say which tolerance absorbs that and
 * which comparisons are between constant (held) chapters and need none.
 */
const NUDGE = 2

const scrollYFor = (geo: Geometry, i: number, t: number): number => {
  const top = geo.tops[i] as number
  const end = i < geo.tops.length - 1 ? (geo.tops[i + 1] as number) : geo.lastBottom
  return top + t * (end - top) - geo.trigger + NUDGE
}

const activeIdAt = (geo: Geometry, i: number, t: number): string =>
  geo.ids[Math.min(i + (t >= 1 ? 1 : 0), geo.ids.length - 1)] as string

const settleAt = async (page: Page, geo: Geometry, i: number, t: number): Promise<void> => {
  await page.evaluate(y => window.scrollTo(0, Math.max(0, y)), scrollYFor(geo, i, t))
  await page.waitForFunction(
    id => document.getElementById('story')?.getAttribute('data-active-step') === id,
    activeIdAt(geo, i, t),
    { timeout: 3000 }
  )
  // two frames: the step-change batch, then the same-update progress write
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)))
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)))
}

type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number }

const cameraMatrix = (page: Page): Promise<Matrix> =>
  page.evaluate(() => {
    const camera = document.querySelector('[data-camera]') as SVGGraphicsElement
    const m = new DOMMatrixReadOnly(getComputedStyle(camera).transform)
    return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f }
  })

const cameraTransformProp = (page: Page): Promise<string> =>
  page.evaluate(() =>
    getComputedStyle(document.getElementById('story') as HTMLElement)
      .getPropertyValue('--camera-transform')
      .trim()
  )

/*
 * The stage's own center in the camera element's untransformed (viewBox)
 * space — the fixed anchor every shot's translate is composed against (SPEC
 * §15.3). Re-derived here with real `getScreenCTM`/`DOMPoint` math rather
 * than read off the library, so the focus center recovered below is a
 * measurement and not a readback of internal state. (Same derivation as
 * e2e/zoom-tour.spec.ts's; specs own their own harness.)
 */
const stageCenterLocal = (page: Page): Promise<{ x: number; y: number }> =>
  page.evaluate(() => {
    const story = document.getElementById('story') as HTMLElement
    const figure = story.querySelector(':scope > figure') as HTMLElement
    const camera = story.querySelector('[data-camera]') as SVGGraphicsElement
    const ctm = (camera.parentNode as unknown as SVGSVGElement).getScreenCTM()
    if (!ctm) throw new Error('focus-coords fixture: camera parent has no screen CTM')
    const inv = ctm.inverse()
    const r = figure.getBoundingClientRect()
    const p1 = new DOMPoint(r.left, r.top).matrixTransform(inv)
    const p2 = new DOMPoint(r.right, r.bottom).matrixTransform(inv)
    return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
  })

/** The shot the camera is currently framing: its magnification and its focus center. */
type Framing = { k: number; cx: number; cy: number }

const framingOf = async (page: Page, center: { x: number; y: number }): Promise<Framing> => {
  const m = await cameraMatrix(page)
  // The camera never rotates or skews (translate · uniform scale · translate),
  // so the shot is fully recoverable from the scale and the translate.
  expect(m.b).toBe(0)
  expect(m.c).toBe(0)
  expect(m.d).toBeCloseTo(m.a, 6)
  return { k: m.a, cx: (center.x - m.e) / m.a, cy: (center.y - m.f) / m.a }
}

/*
 * Two decimals is the tightest honest bar for a recovered framing. Chromium
 * serializes the resolved transform at limited precision and recovering the
 * focus center divides the translate by the scale, which amplifies that
 * rounding to ~1e-3 viewBox units; and a chapter that FLIES is sampled 2px
 * past its own start (see NUDGE), which moves the magnification by a similar
 * amount. Both are float-formatting noise against the failure this measures —
 * a coordinate box read into the wrong space, or framed by the wrong rule, is
 * wrong by tens or hundreds of units.
 */
const FRAMING_DIGITS = 2

const expectSameFraming = (actual: Framing, expected: Framing) => {
  expect(actual.cx).toBeCloseTo(expected.cx, FRAMING_DIGITS)
  expect(actual.cy).toBeCloseTo(expected.cy, FRAMING_DIGITS)
  expect(actual.k).toBeCloseTo(expected.k, FRAMING_DIGITS)
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

/*
 * The clean fixture: `#anchor` is authored at x=120 y=340 w=400 h=300, and
 * the four chapters frame it as `120 340 400 300`, `#anchor`, and each of
 * those again with `data-zoom="2"`. Chapters 0, 2 and 3 are held/no-op
 * flights (adjacent shots are equal), so their samples are exact; chapter 1
 * is the one flight in the page (fit -> 2x), which is why the fit pair's
 * magnification carries a two-decimal tolerance while its focus center — the
 * same point at both ends of that flight, so exact at every t — does not.
 */
test.describe('§16 a coordinate box is the subject, exactly as a selector’s bbox is', () => {
  test.describe.configure({ mode: 'serial' })

  let page: Page
  let geo: Geometry
  let center: { x: number; y: number }
  let record: Console

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    record = recordConsole(page)
    await page.goto(CLEAN)
    geo = await chapterGeometry(page)
    expect(geo.ids).toEqual(['coord', 'sel', 'coord-zoom', 'sel-zoom'])
    await settleAt(page, geo, 0, 0)
    center = await stageCenterLocal(page)
  })

  test.afterAll(async () => {
    await page.close()
  })

  const framingAtChapter = async (i: number, t = 0): Promise<Framing> => {
    await settleAt(page, geo, i, t)
    return framingOf(page, center)
  }

  test('the coordinate box and the selector resolve the same settled shot', async () => {
    const coord = await framingAtChapter(0)
    const sel = await framingAtChapter(1)

    // The authored box's own center, in viewBox units — the coordinate form is
    // read in the camera's untransformed space, not in screen pixels.
    expect(coord.cx).toBeCloseTo(320, FRAMING_DIGITS)
    expect(coord.cy).toBeCloseTo(490, FRAMING_DIGITS)

    expectSameFraming(sel, coord)
  })

  test('data-zoom overrides the fit default identically for both forms', async () => {
    const coord = await framingAtChapter(0)
    const coordZoom = await framingAtChapter(2)
    const selZoom = await framingAtChapter(3)

    // Both overridden chapters are held (their neighbours' shots are equal),
    // so these two agree far beyond the flight tolerance.
    expect(selZoom.cx).toBeCloseTo(coordZoom.cx, FRAMING_DIGITS)
    expect(selZoom.cy).toBeCloseTo(coordZoom.cy, FRAMING_DIGITS)
    expect(selZoom.k).toBeCloseTo(coordZoom.k, 5)

    // data-zoom IS the magnification, verbatim…
    expect(coordZoom.k).toBeCloseTo(2, 5)
    // …and the un-overridden pair really did frame differently (the fit
    // default), so the equality above is not two copies of the same default.
    expect(Math.abs(coordZoom.k - coord.k)).toBeGreaterThan(0.1)
    // Same subject either way: the override changes framing, never the subject.
    expect(coordZoom.cx).toBeCloseTo(coord.cx, FRAMING_DIGITS)
    expect(coordZoom.cy).toBeCloseTo(coord.cy, FRAMING_DIGITS)
  })

  test('a story of well-formed coordinate boxes says nothing on the console', async () => {
    for (const i of [0, 1, 2, 3]) await settleAt(page, geo, i, 0)
    await settleAt(page, geo, 0, 0)

    expect(moviolaWarnings(record)).toEqual([])
    expect(record.errors).toEqual([])
    expect(record.pageErrors).toEqual([])
  })
})

/*
 * The mid-story broken fixture: `open` (valid) — `short`, `nan`, `flat`
 * (malformed) — `land` (valid). `open`'s chapter is the flight, and per
 * §15.3 it flies toward the next step with an own shot, which is `land`: so
 * the shot every malformed chapter holds is LAND's, the one the story has
 * actually arrived at, not `open`'s. That is the hold under test — the
 * assertions compare against the measured arrival, never a hard-coded matrix.
 */
test.describe('§16 a malformed coordinate box mid-story holds the arrived shot', () => {
  test.describe.configure({ mode: 'serial' })

  const MALFORMED = [
    { i: 1, id: 'short', value: '120 340' },
    { i: 2, id: 'nan', value: '120 340 400 NaN' },
    { i: 3, id: 'flat', value: '120 340 -400 300' },
  ] as const

  let page: Page
  let geo: Geometry
  let center: { x: number; y: number }
  let record: Console

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    record = recordConsole(page)
    await page.goto(MID)
    geo = await chapterGeometry(page)
    expect(geo.ids).toEqual(['open', 'short', 'nan', 'flat', 'land'])
    await settleAt(page, geo, 0, 0)
    center = await stageCenterLocal(page)
  })

  test.afterAll(async () => {
    await page.close()
  })

  test('each malformed chapter is a constant equal to the shot reached before it', async () => {
    await settleAt(page, geo, 4, 0)
    const arrival = await framingOf(page, center) // `land`'s own shot: the arrival

    await settleAt(page, geo, 0, 0)
    const openStart = await framingOf(page, center)
    await settleAt(page, geo, 0, 0.5)
    const openMid = await framingOf(page, center)

    // The flight is real: `open`'s chapter starts somewhere else, passes
    // through somewhere else again, and lands on the arrival above. Without
    // this, "the malformed chapters equal the arrival" could be satisfied by a
    // camera that simply never moved.
    expect(Math.hypot(openStart.cx - arrival.cx, openStart.cy - arrival.cy)).toBeGreaterThan(50)
    expect(Math.hypot(openMid.cx - arrival.cx, openMid.cy - arrival.cy)).toBeGreaterThan(1)

    for (const { i, id } of MALFORMED) {
      for (const t of [0, 0.5, 1]) {
        await settleAt(page, geo, i, t)
        const held = await framingOf(page, center)
        expect(held.cx, `chapter ${id} at t=${t}`).toBeCloseTo(arrival.cx, 3)
        expect(held.cy, `chapter ${id} at t=${t}`).toBeCloseTo(arrival.cy, 3)
        expect(held.k, `chapter ${id} at t=${t}`).toBeCloseTo(arrival.k, 5)
      }
    }
  })

  test('exactly three distinct moviola: warns, one per malformed value', async () => {
    const warns = moviolaWarnings(record)
    expect(warns).toHaveLength(3)
    expect(new Set(warns).size).toBe(3)
    for (const { value } of MALFORMED) {
      expect(warns.filter(w => w.includes(`data-focus="${value}"`))).toHaveLength(1)
    }
  })

  test('every diagnostic is a console.warn — never an error, never a page throw', () => {
    expect(record.errors).toEqual([])
    expect(record.pageErrors).toEqual([])
  })

  test('no warn duplicates across repeated traversals or a resize (§15.6)', async () => {
    for (const { i } of MALFORMED) await settleAt(page, geo, i, 0.5)

    await page.setViewportSize({ width: 900, height: 700 })
    await page.waitForFunction(() => window.innerWidth === 900)
    geo = await chapterGeometry(page) // the trigger line moved with the viewport
    await settleAt(page, geo, 2, 0.5)

    await page.setViewportSize({ width: 1000, height: 800 })
    await page.waitForFunction(() => window.innerWidth === 1000)
    geo = await chapterGeometry(page)
    await settleAt(page, geo, 3, 0.5)

    expect(moviolaWarnings(record)).toHaveLength(3)
    expect(record.errors).toEqual([])
    expect(record.pageErrors).toEqual([])
  })
})

/*
 * The first-shot broken fixture: the ROOT's establishing value is malformed
 * and the first step asks for nothing, so there is no previous shot to hold.
 * Each test drives its own page — once any valid shot resolves the runtime
 * keeps that value on the root (it never clears `--camera-transform`
 * mid-story), so "never written" is only observable on a page that has not
 * yet reached `reveal`.
 */
test.describe('§16 a malformed FIRST shot writes no --camera-transform at all', () => {
  test('nothing is written at the top of the story, nor through the first chapter', async ({
    browser,
  }) => {
    const page = await browser.newPage()
    const record = recordConsole(page)
    await page.goto(FIRST)
    const geo = await chapterGeometry(page)
    expect(geo.ids).toEqual(['intro', 'reveal', 'settle'])

    await page.evaluate(() => window.scrollTo(0, 0))
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)))
    expect(await cameraTransformProp(page)).toBe('')

    // t stops short of 1: the chapter's own end is the instant `reveal`
    // activates, and `reveal` is exactly where a transform legitimately
    // appears.
    for (const t of [0, 0.5, 0.9]) {
      await settleAt(page, geo, 0, t)
      expect(await cameraTransformProp(page), `intro at t=${t}`).toBe('')
    }

    expect(moviolaWarnings(record)).toHaveLength(1)
    expect(moviolaWarnings(record)[0]).toContain('data-focus="120 340 400"')
    expect(record.errors).toEqual([])
    expect(record.pageErrors).toEqual([])

    await page.close()
  })

  test('the property appears, framing the authored box, once a valid shot resolves', async ({
    browser,
  }) => {
    const page = await browser.newPage()
    const record = recordConsole(page)
    await page.goto(FIRST)
    const geo = await chapterGeometry(page)

    await settleAt(page, geo, 1, 0)
    expect(await cameraTransformProp(page)).not.toBe('')

    const center = await stageCenterLocal(page)
    const framing = await framingOf(page, center)
    // `reveal` asks for `200 100 300 200`, whose center is (350, 200).
    expect(framing.cx).toBeCloseTo(350, FRAMING_DIGITS)
    expect(framing.cy).toBeCloseTo(200, FRAMING_DIGITS)

    // The malformed establishing value is still reported exactly once, and the
    // story runs on regardless.
    expect(moviolaWarnings(record)).toHaveLength(1)
    expect(record.errors).toEqual([])
    expect(record.pageErrors).toEqual([])

    await page.close()
  })
})
