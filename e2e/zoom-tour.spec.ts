/*
 * M212 acceptance probe for examples/zoom-tour.html — a net-new Tier-1
 * story exercising the declarative camera (§15.3) AND chapter-timeline
 * scrubbing (§15.2) IN THE SAME CHAPTERS (SPEC §15.7 bullet 4). This spec
 * pins directly to the ticket's acceptance items 2 (camera-tour probe), 3
 * (attribute floor), 4 (scrub-liveness probe) and 6 (anti-filler floors) —
 * reviewing it should be a read against that list, not an audit.
 *
 * Geometry is measured from the live DOM (step `getBoundingClientRect` +
 * the root's own `data-offset`, default 0.5) rather than hand-derived pixel
 * constants — the page's own prose determines step heights, and the §5.2
 * chapter-progress formula (`--progress-<id>`/`--step-progress`) is a pure
 * function of that geometry: chapter i spans [top(step i), top(step i+1))
 * (or the figure's own bottom for the last step), offset by the trigger
 * line. See SPEC §5.2 / §15.2.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'

const root = path.join(import.meta.dirname, '..')
const FILE = path.join(root, 'examples/zoom-tour.html')
const URL = `file://${FILE}`

type Geometry = {
  ids: string[]
  tops: number[]
  lastBottom: number
  trigger: number
}

const chapterGeometry = (page: Page): Promise<Geometry> =>
  page.evaluate(() => {
    const story = document.getElementById('story') as HTMLElement
    const offset = Number.parseFloat(story.dataset.offset ?? '0.5')
    const steps = [...story.querySelectorAll(':scope > .step')] as HTMLElement[]
    const tops = steps.map(s => s.getBoundingClientRect().top + window.scrollY)
    const lastBottom =
      (steps[steps.length - 1] as HTMLElement).getBoundingClientRect().bottom + window.scrollY
    return { ids: steps.map(s => s.id), tops, lastBottom, trigger: window.innerHeight * offset }
  })

// scrollY at fractional progress `t` (0..1) through chapter `i` — mirrors the
// runtime's own chapter span exactly (§5.2/§15.2): [top(i), top(i+1)) for
// interior steps, [top(i), lastBottom) for the final one.
const scrollYFor = (geo: Geometry, i: number, t: number) => {
  const top = geo.tops[i] as number
  const span = i < geo.tops.length - 1 ? (geo.tops[i + 1] as number) - top : geo.lastBottom - top
  return top + t * span - geo.trigger
}

const settleTo = async (page: Page, y: number) => {
  await page.evaluate(y => window.scrollTo(0, Math.max(0, y)), y)
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)))
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)))
}

const settleAtStep = async (page: Page, geo: Geometry, i: number, t: number) => {
  await settleTo(page, scrollYFor(geo, i, t))
  await page.waitForFunction(
    id => document.getElementById('story')?.getAttribute('data-active-step') === id,
    geo.ids[Math.min(i + (t >= 1 ? 1 : 0), geo.ids.length - 1)],
    { timeout: 3000 }
  )
}

type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number }

const cameraMatrix = (page: Page): Promise<Matrix> =>
  page.evaluate(() => {
    const camera = document.querySelector('[data-camera]') as SVGGraphicsElement
    const m = new DOMMatrixReadOnly(getComputedStyle(camera).transform)
    return { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f }
  })

// The stage's own screen-center in the camera element's untransformed
// (local/parent) coordinate space — the same fixed reference point the
// runtime's own B()/q() use as the translate anchor for every shot (SPEC
// §15.3). Independently re-derived here (real getScreenCTM/DOMPoint math,
// not read off the library) so the recovered camera-center below is an
// honest measurement, not a readback of internal state.
const stageCenterLocal = (page: Page): Promise<{ x: number; y: number }> =>
  page.evaluate(() => {
    const story = document.getElementById('story') as HTMLElement
    const figure = story.querySelector(':scope > figure') as HTMLElement
    const camera = story.querySelector('[data-camera]') as SVGGraphicsElement
    const parent = camera.parentNode as unknown as SVGSVGElement
    const ctm = parent.getScreenCTM()
    if (!ctm) throw new Error('zoom-tour fixture: camera parent has no screen CTM')
    const inv = ctm.inverse()
    const r = figure.getBoundingClientRect()
    const p1 = new DOMPoint(r.left, r.top).matrixTransform(inv)
    const p2 = new DOMPoint(r.right, r.bottom).matrixTransform(inv)
    return {
      x: (Math.min(p1.x, p2.x) + Math.max(p1.x, p2.x)) / 2,
      y: (Math.min(p1.y, p2.y) + Math.max(p1.y, p2.y)) / 2,
    }
  })

const stageDiagonal = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const svg = document.querySelector('#story svg') as SVGSVGElement
    const box = svg.viewBox.baseVal
    return Math.hypot(box.width, box.height)
  })

const figureShot = (page: Page) => page.locator('#story > figure').screenshot()

test.describe.configure({ mode: 'serial' })

let page: Page
let geo: Geometry

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  await page.goto(URL)
  geo = await chapterGeometry(page)
})

test.afterAll(async () => {
  await page.close()
})

/*
 * Acceptance 3 — attribute floor (static DOM, no scrolling required).
 */
test.describe('acceptance 3: attribute floor', () => {
  test('>=4 steps carry data-focus, >=3 distinct focus targets, >=2 distinct data-zoom values', async () => {
    const attrs = await page.evaluate(() => {
      const steps = [
        ...(document.getElementById('story') as HTMLElement).querySelectorAll(':scope > .step'),
      ] as HTMLElement[]
      return steps.map(s => ({
        id: s.id,
        focus: s.dataset.focus ?? null,
        zoom: s.dataset.zoom ?? null,
      }))
    })
    const focused = attrs.filter(s => s.focus !== null)
    expect(focused.length).toBeGreaterThanOrEqual(4)
    expect(new Set(focused.map(s => s.focus)).size).toBeGreaterThanOrEqual(3)
    expect(new Set(focused.map(s => s.zoom).filter(Boolean)).size).toBeGreaterThanOrEqual(2)
  })

  test('>=2 step ids carry data-focus AND some element carries data-scrub with that same id', async () => {
    const { focusedStepIds, scrubIds } = await page.evaluate(() => {
      const story = document.getElementById('story') as HTMLElement
      const steps = [...story.querySelectorAll(':scope > .step')] as HTMLElement[]
      const focusedStepIds = steps.filter(s => s.hasAttribute('data-focus')).map(s => s.id)
      const scrubIds = [...story.querySelectorAll('[data-scrub]')].map(
        el => (el as HTMLElement).dataset.scrub
      )
      return { focusedStepIds, scrubIds }
    })
    const scrubIdSet = new Set(scrubIds)
    const overlap = focusedStepIds.filter(id => scrubIdSet.has(id))
    expect(overlap.length).toBeGreaterThanOrEqual(2)
  })
})

/*
 * Acceptance 2 — camera-tour probe. Samples the RESOLVED transform matrix
 * (never the --camera-transform custom property string) at >=40 positions
 * spanning the first step's top to the last step's bottom.
 */
test.describe('acceptance 2: camera-tour probe', () => {
  test('>=10 distinct matrices, >=3x scale range, >=30% stage-diagonal center displacement', async () => {
    const diagonal = await stageDiagonal(page)
    const center0 = await stageCenterLocal(page)

    const first = (geo.tops[0] as number) - geo.trigger
    const last = geo.lastBottom - geo.trigger
    const SAMPLES = 48
    const samples: Array<{ matrix: Matrix; cx: number; cy: number }> = []
    for (let i = 0; i <= SAMPLES; i++) {
      const y = first + ((last - first) * i) / SAMPLES
      await settleTo(page, y)
      const m = await cameraMatrix(page)
      // camera never rotates/skews (translate * uniform-scale * translate,
      // SPEC §15.3) — recover the local focus point from the fixed stage
      // center and the resolved scale/translate.
      const cx = (center0.x - m.e) / m.a
      const cy = (center0.y - m.f) / m.a
      samples.push({ matrix: m, cx, cy })
    }

    expect(samples.length).toBeGreaterThanOrEqual(40)

    const rounded = samples.map(
      s =>
        `${s.matrix.a.toFixed(2)},${s.matrix.b.toFixed(2)},${s.matrix.c.toFixed(2)},${s.matrix.d.toFixed(2)},${s.matrix.e.toFixed(2)},${s.matrix.f.toFixed(2)}`
    )
    expect(new Set(rounded).size).toBeGreaterThanOrEqual(10)

    const scales = samples.map(s => s.matrix.a)
    const maxScale = Math.max(...scales)
    const minScale = Math.min(...scales)
    expect(maxScale / minScale).toBeGreaterThanOrEqual(3)

    let maxDisplacement = 0
    for (let i = 0; i < samples.length; i++) {
      const si = samples[i] as { cx: number; cy: number }
      for (let j = i + 1; j < samples.length; j++) {
        const sj = samples[j] as { cx: number; cy: number }
        const d = Math.hypot(si.cx - sj.cx, si.cy - sj.cy)
        if (d > maxDisplacement) maxDisplacement = d
      }
    }
    expect(maxDisplacement).toBeGreaterThanOrEqual(0.3 * diagonal)
  })

  test('an adjacent focused-step pair: the midpoint differs from BOTH endpoints (screenshot and matrix)', async () => {
    // "split-elevation" -> "ny-region": both carry data-focus and are
    // adjacent in document order. Per SPEC §15.3 the flight from
    // split-elevation's own shot to ny-region's shot plays out across
    // split-elevation's OWN chapter, arriving exactly as ny-region
    // activates — the same pattern e2e/motion.spec.ts's CAMERA_HTML proves.
    const i = geo.ids.indexOf('split-elevation')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(geo.ids[i + 1]).toBe('ny-region')

    await settleAtStep(page, geo, i, 0)
    const startShot = await figureShot(page)
    const startMatrix = await cameraMatrix(page)

    await settleAtStep(page, geo, i, 0.5)
    const midShot = await figureShot(page)
    const midMatrix = await cameraMatrix(page)

    await settleAtStep(page, geo, i, 1)
    const endShot = await figureShot(page)
    const endMatrix = await cameraMatrix(page)

    expect(Buffer.compare(midShot, startShot)).not.toBe(0)
    expect(Buffer.compare(midShot, endShot)).not.toBe(0)
    expect(midMatrix).not.toEqual(startMatrix)
    expect(midMatrix).not.toEqual(endMatrix)
  })
})

/*
 * Acceptance 4 — scrub-liveness probe: every [data-scrub] element must have
 * a real (non-"none") animation, paused (the runtime drives it via
 * animation-delay against --t, never animation-play-state: running); and for
 * each distinct scrub id, at least one carrying element must visibly move
 * between in-chapter progress ~0.25 and ~0.75 while staying on-stage.
 */
test.describe('acceptance 4: scrub-liveness probe', () => {
  test('every [data-scrub] element has a real, paused animation', async () => {
    await settleTo(page, 0)
    const states = await page.evaluate(() =>
      [...document.querySelectorAll('[data-scrub]')].map(el => {
        const cs = getComputedStyle(el as HTMLElement)
        return { name: cs.animationName, playState: cs.animationPlayState }
      })
    )
    expect(states.length).toBeGreaterThan(0)
    for (const s of states) {
      expect(s.name).not.toBe('none')
      expect(s.playState).toBe('paused')
    }
  })

  test('each distinct scrub id visibly changes between progress ~0.25 and ~0.75, staying on-stage', async () => {
    const scrubIds = await page.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll('[data-scrub]')].map(
          el => (el as HTMLElement).dataset.scrub as string
        )
      ),
    ])
    expect(scrubIds.length).toBeGreaterThanOrEqual(2)

    // Recomputed per sample, AFTER settling: the figure is `position: sticky`
    // and only pins to the viewport once its containing block has scrolled
    // into view, so its rect at an arbitrary earlier scroll position (e.g.
    // leftover from a previous test) is not representative.
    const sampleScrubId = async (scrubId: string, i: number, t: number) => {
      await settleAtStep(page, geo, i, t)
      const figureRect = await page.evaluate(() => {
        const r = (document.querySelector('#story > figure') as HTMLElement).getBoundingClientRect()
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
      })
      return page.evaluate(
        ({ id, fig }) =>
          [...document.querySelectorAll(`[data-scrub="${id}"]`)].map(el => {
            const cs = getComputedStyle(el as Element)
            const r = (el as Element).getBoundingClientRect()
            const intersects =
              r.left < fig.right && r.right > fig.left && r.top < fig.bottom && r.bottom > fig.top
            return {
              transform: cs.transform,
              visible:
                r.width > 0 && r.height > 0 && Number.parseFloat(cs.opacity) >= 0.05 && intersects,
            }
          }),
        { id: scrubId, fig: figureRect }
      )
    }

    for (const scrubId of scrubIds) {
      const i = geo.ids.indexOf(scrubId)
      expect(i).toBeGreaterThanOrEqual(0) // this page keys every scrub id to its own chapter

      const at25 = await sampleScrubId(scrubId, i, 0.25)
      const at75 = await sampleScrubId(scrubId, i, 0.75)
      expect(at25.length).toBe(at75.length)
      expect(at25.length).toBeGreaterThan(0)

      const liveIndex = at25.findIndex(
        (s, idx) => s.transform !== (at75[idx] as (typeof at75)[number]).transform
      )
      expect(
        liveIndex,
        `data-scrub="${scrubId}" never visibly changes between t=0.25 and t=0.75`
      ).toBeGreaterThanOrEqual(0)
      expect((at25[liveIndex] as (typeof at25)[number]).visible).toBe(true)
      expect((at75[liveIndex] as (typeof at75)[number]).visible).toBe(true)
    }
  })
})

/*
 * Acceptance 6 (DOM-checkable half) — anti-filler floors. The token-overlap
 * anti-clone check against examples/virus-got-out.html is the coordinator's
 * independent gate, not reproducible as a stable in-repo assertion; this
 * spec owns the mechanical floors only.
 */
test.describe('acceptance 6: anti-filler floors', () => {
  test('no lorem/ipsum/placeholder/tbd/fixme anywhere in the page', () => {
    const html = readFileSync(FILE, 'utf8')
    expect(html).not.toMatch(/lorem|ipsum|placeholder|tbd|fixme/i)
  })

  test('every .step has >=120 chars of text; the page totals >=1200', async () => {
    const lengths = await page.evaluate(() =>
      [...document.querySelectorAll('.step')].map(s => (s.textContent ?? '').trim().length)
    )
    expect(lengths.length).toBeGreaterThan(0)
    for (const len of lengths) expect(len).toBeGreaterThanOrEqual(120)
    expect(lengths.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1200)
  })
})
