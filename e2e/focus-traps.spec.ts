/*
 * §16 the two PINNED TRAPS of the first-character `data-focus` rule, in a real
 * browser. `".5 0 10 10"` and `"+50 0 200 100"` both look like coordinate
 * boxes; the rule reads exactly one character, so both take the SELECTOR path
 * — and neither is parseable CSS (a class token opening with a digit, and a
 * leading bare combinator). `document.querySelector` throws a DOMException on
 * both.
 *
 * That throw must never escape. The pinned disposition for these two values is
 * "matches no element": one warn each, the camera holding the shot it already
 * arrived at, the story running on (§15.6 fail-soft — a warning page keeps
 * working). A unit test on the pure parser cannot see any of this, because the
 * parser's answer for both values is simply `selector`; only a page that puts
 * a trap value in front of `querySelector` can. Hence this spec.
 *
 * The fixture embeds the built library (marker blocks, `bun run build`) and is
 * a plain `file://` page — what ships is what is asserted here. Geometry comes
 * from the live DOM (§5.1's trigger line against each step's own rect).
 */
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'

const root = path.join(import.meta.dirname, '..')
const TRAPS = `file://${path.join(root, 'e2e/fixtures-broken/focus-traps.html')}`

const TRAP_VALUES = ['.5 0 10 10', '+50 0 200 100'] as const

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

// A chapter boundary activates the LATER step, so samples sit a hair past the
// boundary they name (see e2e/focus-coords.spec.ts for the full derivation).
const NUDGE = 2

const scrollYFor = (geo: Geometry, i: number, t: number): number => {
  const top = geo.tops[i] as number
  const end = i < geo.tops.length - 1 ? (geo.tops[i + 1] as number) : geo.lastBottom
  return top + t * (end - top) - geo.trigger + NUDGE
}

const settleAt = async (page: Page, geo: Geometry, i: number, t: number): Promise<void> => {
  await page.evaluate(y => window.scrollTo(0, Math.max(0, y)), scrollYFor(geo, i, t))
  await page.waitForFunction(
    id => document.getElementById('story')?.getAttribute('data-active-step') === id,
    geo.ids[Math.min(i + (t >= 1 ? 1 : 0), geo.ids.length - 1)] as string,
    { timeout: 3000 }
  )
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

test.describe('§16 an unparseable data-focus selector fails soft', () => {
  test.describe.configure({ mode: 'serial' })

  let page: Page
  let geo: Geometry
  let record: Console

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage()
    record = recordConsole(page)
    await page.goto(TRAPS)
    geo = await chapterGeometry(page)
    expect(geo.ids).toEqual(['open', 'dot', 'plus', 'land'])
    // Walk the whole story once, so every trap value has actually reached
    // querySelector before anything below is asserted.
    for (const i of [0, 1, 2, 3]) await settleAt(page, geo, i, 0.5)
  })

  test.afterAll(async () => {
    await page.close()
  })

  test('the story survives both traps: no page error, no console.error', () => {
    // The regression this pins: an unguarded querySelector throws out of
    // measureShots -> Motion's constructor -> Moviola.init, so the whole story
    // dies at init and the page reports a single uncaught DOMException.
    expect(record.pageErrors).toEqual([])
    expect(record.errors).toEqual([])
  })

  test('each trap warns exactly once, as "matches no element", naming its own value', () => {
    const warns = moviolaWarnings(record)
    expect(warns).toHaveLength(2)
    expect(new Set(warns).size).toBe(2)
    for (const value of TRAP_VALUES) {
      const own = warns.filter(w => w.includes(`data-focus="${value}"`))
      expect(own).toHaveLength(1)
      expect(own[0]).toContain('matches no element')
    }
    // Every one of them is a warning, never a louder channel.
    expect(record.warnings.filter(w => w.startsWith('moviola:'))).toHaveLength(2)
  })

  test('the state machine still advances through and past both trap chapters', async () => {
    for (const [i, id] of geo.ids.entries()) {
      await settleAt(page, geo, i, 0.5)
      expect(await page.getAttribute('#story', 'data-active-step')).toBe(id)
    }
  })

  test('both trap chapters hold the arrived shot, constant, exactly as an absent attribute would', async () => {
    // `open` flies toward the next step with an own shot — `land` — so the
    // shot the traps hold is `land`'s, sampled here from its own chapter.
    await settleAt(page, geo, 3, 0)
    const arrival = await cameraMatrix(page)

    await settleAt(page, geo, 0, 0)
    const openStart = await cameraMatrix(page)
    // The flight really happened, so "held" is a claim about a moving camera.
    expect(Math.hypot(openStart.e - arrival.e, openStart.f - arrival.f)).toBeGreaterThan(1)

    for (const [i, id] of [
      [1, 'dot'],
      [2, 'plus'],
    ] as const) {
      for (const t of [0, 0.5, 1]) {
        await settleAt(page, geo, i, t)
        const held = await cameraMatrix(page)
        expect(held.a, `chapter ${id} at t=${t}`).toBeCloseTo(arrival.a, 5)
        expect(held.e, `chapter ${id} at t=${t}`).toBeCloseTo(arrival.e, 3)
        expect(held.f, `chapter ${id} at t=${t}`).toBeCloseTo(arrival.f, 3)
      }
    }
  })

  test('neither warn duplicates across a re-traversal or a resize (§15.6)', async () => {
    await page.setViewportSize({ width: 900, height: 700 })
    await page.waitForFunction(() => window.innerWidth === 900)
    geo = await chapterGeometry(page)
    await settleAt(page, geo, 1, 0.5)
    await settleAt(page, geo, 2, 0.5)

    await page.setViewportSize({ width: 1000, height: 800 })
    await page.waitForFunction(() => window.innerWidth === 1000)
    geo = await chapterGeometry(page)
    await settleAt(page, geo, 2, 0.5)
    await settleAt(page, geo, 1, 0.5)

    expect(moviolaWarnings(record)).toHaveLength(2)
    expect(record.pageErrors).toEqual([])
    expect(record.errors).toEqual([])
  })
})
