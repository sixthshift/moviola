/*
 * §15.2 data-scrub: the paused-animation-plus-negative-delay mechanic,
 * proven against real Chromium. Fixture is inline (route-served, same trick
 * as dist.spec.ts) rather than a checked-in file — this spec owns its own
 * one-step geometry: viewport 1000×800, trigger at 400, the sole chapter
 * "scene" spans document y 2000..3000, so `--progress-scene` (and this
 * spec's `--t`) is a pure function of scrollY:
 *
 *   progress(scrollY) = (scrollY - 1600) / 1000
 *
 * `#ga` carries both `data-show="scene"` and `data-scrub="scene"` (the
 * composability red-team) and animates `left: 0px -> 200px`. `#over`
 * overrides `animation-delay` to a fixed `-0.5s`, pinning it to the
 * keyframe midpoint regardless of scroll — the author-override red-team.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'

declare global {
  interface Window {
    __warnings: string[]
  }
}

const root = path.join(import.meta.dirname, '..')
const ORIGIN = 'http://scrolly-motion.test'

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/dist/scrolly.css">
<style>
  body { margin: 0; }
  #spacer { height: 2000px; }
  .scrolly > .step { min-height: 0; height: 1000px; margin: 0; }
  #ga, #over {
    position: relative; left: 0px; width: 10px; height: 10px;
    animation-name: ride; animation-timing-function: linear;
  }
  @keyframes ride { from { left: 0px; } to { left: 200px; } }
  /* author override (§15.2 rule: "the mechanic is a default, not a
     contract") — pinned to the midpoint no matter what --t says. */
  #over { animation-delay: -0.5s; }
</style>
</head>
<body>
<div id="spacer"></div>
<article id="story" class="scrolly" data-layout="side-right">
  <figure>
    <div id="ga" data-show="scene" data-scrub="scene"></div>
    <div id="over" data-scrub="scene"></div>
  </figure>
  <section class="step" id="scene"><p>scene</p></section>
</article>
<div style="height: 1000px"></div>
<script src="/dist/scrolly.min.js"></script>
<script>window.__story = Scrolly.init('#story')</script>
</body>
</html>
`

const NOJS_HTML = HTML.replace(
  `<script src="/dist/scrolly.min.js"></script>
<script>window.__story = Scrolly.init('#story')</script>
`,
  ''
)

const TYPES: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css' }

const serve = async (page: Page, html: string) => {
  await page.route(`${ORIGIN}/**`, route => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/fixture.html') {
      return route.fulfill({ contentType: 'text/html', body: html })
    }
    try {
      return route.fulfill({
        contentType: TYPES[path.extname(pathname)] ?? 'application/octet-stream',
        body: readFileSync(path.join(root, pathname.slice(1))),
      })
    } catch {
      return route.fulfill({ status: 404, body: 'not found' })
    }
  })
  await page.goto(`${ORIGIN}/fixture.html`)
}

// progress(scrollY) = (scrollY - 1600) / 1000, see header.
const scrollYFor = (t: number) => 1600 + t * 1000

const left = (page: Page, id: string) =>
  page.evaluate(
    id => parseFloat(getComputedStyle(document.getElementById(id) as HTMLElement).left),
    id
  )

const settleAt = async (page: Page, t: number) => {
  await page.evaluate(y => window.scrollTo(0, y), scrollYFor(t))
  await page.waitForFunction(
    () => document.querySelector('#story')?.getAttribute('data-active-step') === 'scene',
    undefined,
    { timeout: 3000 }
  )
  // one extra frame so the same-update progress vars are flushed (mirrors
  // e2e/semantics.spec.ts's scrollToAndSettle)
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)))
}

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  await serve(page, HTML)
})

test.afterAll(async () => {
  await page.close()
})

test('advances forward through the chapter: 0% -> ~50% -> 100%', async () => {
  await settleAt(page, 0)
  expect(await left(page, 'ga')).toBeCloseTo(0, 0)

  await settleAt(page, 0.5)
  expect(await left(page, 'ga')).toBeCloseTo(100, 0)

  await settleAt(page, 1)
  expect(await left(page, 'ga')).toBeCloseTo(200, 0)
})

test('rewinds on reverse scroll, mirroring forward exactly', async () => {
  // continuing from t=1 (previous test)
  await settleAt(page, 0.5)
  expect(await left(page, 'ga')).toBeCloseTo(100, 0)

  await settleAt(page, 0)
  expect(await left(page, 'ga')).toBeCloseTo(0, 0)
})

test('data-scrub composes with data-show on the same element', async () => {
  await settleAt(page, 0.75)
  const state = await page.evaluate(() => {
    const el = document.getElementById('ga') as HTMLElement
    return {
      shown: el.classList.contains('is-shown'),
      left: parseFloat(getComputedStyle(el).left),
    }
  })
  expect(state.shown).toBe(true) // visibility mechanic still applies
  expect(state.left).toBeCloseTo(150, 0) // motion mechanic still applies
})

test('author animation-delay override wins over the runtime default', async () => {
  await settleAt(page, 0)
  const start = await page.evaluate(() => ({
    ga: parseFloat(getComputedStyle(document.getElementById('ga') as HTMLElement).left),
    over: parseFloat(getComputedStyle(document.getElementById('over') as HTMLElement).left),
  }))
  await settleAt(page, 1)
  const end = await page.evaluate(() => ({
    ga: parseFloat(getComputedStyle(document.getElementById('ga') as HTMLElement).left),
    over: parseFloat(getComputedStyle(document.getElementById('over') as HTMLElement).left),
  }))

  // #ga (default mechanic) tracks scroll; #over (author-overridden delay)
  // is pinned at the keyframe midpoint throughout.
  expect(start.ga).toBeCloseTo(0, 0)
  expect(end.ga).toBeCloseTo(200, 0)
  expect(start.over).toBeCloseTo(100, 0)
  expect(end.over).toBeCloseTo(100, 0)
})

test('reduced motion quantizes the scrub to a cut at the chapter midpoint', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' })
  const p = await ctx.newPage()
  await serve(p, HTML)

  await settleAt(p, 0.3) // below the midpoint -> quantizes to 0
  expect(await left(p, 'ga')).toBeCloseTo(0, 0)

  await settleAt(p, 0.8) // above the midpoint -> quantizes to 1
  expect(await left(p, 'ga')).toBeCloseTo(200, 0)

  await ctx.close()
})

test('§8.1 no-JS: the scrubbed element stays visible and readable', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false })
  const p = await ctx.newPage()
  await serve(p, NOJS_HTML)

  const visible = await p.evaluate(() => {
    const el = document.getElementById('ga') as HTMLElement
    const style = getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden'
  })
  expect(visible).toBe(true)

  await ctx.close()
})

/*
 * §15.3 the declarative camera. Fixture: viewBox 0 0 1000 1000, an anchor
 * `#a` (portrait, 50×100 at 150,150) and `#b` (200,700, same size) — far
 * enough apart, and non-square, that a flight is visually unmistakable and
 * the default-fit zoom is sensitive to the stage's own aspect ratio (used by
 * the resize case). Steps: a leading "zero" (no focus — pure buffer, see
 * below), "one" focuses #a, "two" focuses #b (so the flight from A to B
 * plays out across "one"'s own chapter progress, §15.3's "earlier step"
 * rule), "three" focuses a selector matching nothing (dangling — holds B,
 * warns). The `<figure>` only becomes sticky (pinned to the viewport top)
 * once the ARTICLE's own top has scrolled past the trigger line; "zero"'s
 * sole job is to hold that crossing well before chapter "one" starts, so
 * every screenshot in this suite is taken against a stage that's actually
 * pinned in place (never a `<figure>` still drifting into position).
 */
const CAMERA_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/dist/scrolly.css">
<style>
  body { margin: 0; }
  #spacer { height: 2000px; }
  .scrolly > .step { min-height: 0; height: 1000px; margin: 0; }
  .scrolly > figure svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
<script>
  window.__warnings = []
  const warn = console.warn.bind(console)
  console.warn = (...args) => { window.__warnings.push(args.join(' ')); warn(...args) }
</script>
<div id="spacer"></div>
<article id="story" class="scrolly" data-layout="side-right">
  <figure>
    <svg viewBox="0 0 1000 1000">
      <g data-camera>
        <rect id="a" x="150" y="150" width="50" height="100" fill="red"/>
        <rect id="b" x="200" y="700" width="50" height="100" fill="blue"/>
      </g>
    </svg>
  </figure>
  <section class="step" id="zero"><p>zero</p></section>
  <section class="step" id="one" data-focus="#a"><p>one</p></section>
  <section class="step" id="two" data-focus="#b"><p>two</p></section>
  <section class="step" id="three" data-focus="#missing"><p>three</p></section>
</article>
<div style="height: 1000px"></div>
<script src="/dist/scrolly.min.js"></script>
<script>window.__story = Scrolly.init('#story')</script>
</body>
</html>
`

// "one" is the second step (doc top 3000, after "zero"): chapter span 1000px,
// so progress(scrollY) = (scrollY - 2600) / 1000.
const camScrollYFor = (t: number) => 2600 + t * 1000

const settleCameraAt = async (page: Page, t: number, expectActive: string) => {
  await page.evaluate(y => window.scrollTo(0, y), camScrollYFor(t))
  await page.waitForFunction(
    id => document.querySelector('#story')?.getAttribute('data-active-step') === id,
    expectActive,
    { timeout: 3000 }
  )
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)))
}

const cameraTransformOf = (page: Page) =>
  page.evaluate(() =>
    document.querySelector<HTMLElement>('#story')?.style.getPropertyValue('--camera-transform')
  )

const shotOf = (page: Page) => page.locator('#story svg').screenshot()

test.describe('§15.3 the declarative camera', () => {
  test.describe.configure({ mode: 'serial' })

  let camPage: Page

  test.beforeAll(async ({ browser }) => {
    camPage = await browser.newPage()
    await serve(camPage, CAMERA_HTML)
  })

  test.afterAll(async () => {
    await camPage.close()
  })

  test('a mid-flight frame differs from both of its endpoints (a flight, not a cut)', async () => {
    await settleCameraAt(camPage, 0, 'one')
    const start = await shotOf(camPage)

    await settleCameraAt(camPage, 0.5, 'one')
    const mid = await shotOf(camPage)

    await settleCameraAt(camPage, 1, 'two')
    const end = await shotOf(camPage)

    expect(Buffer.compare(mid, start)).not.toBe(0)
    expect(Buffer.compare(mid, end)).not.toBe(0)
  })

  test('reverse traversal lands on an identical frame', async () => {
    // continuing from t=1/"two" (previous test)
    await settleCameraAt(camPage, 0.5, 'one')
    const forwardMid = await shotOf(camPage)

    await settleCameraAt(camPage, 1, 'two') // scroll past, then back down to the same spot
    await settleCameraAt(camPage, 0.5, 'one')
    const reverseMid = await shotOf(camPage)

    expect(Buffer.compare(forwardMid, reverseMid)).toBe(0)
  })

  test('a dangling data-focus selector holds the previous shot and warns', async () => {
    await settleCameraAt(camPage, 1, 'two')
    const atTwo = await shotOf(camPage)

    await camPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await camPage.waitForFunction(
      () => document.querySelector('#story')?.getAttribute('data-active-step') === 'three'
    )
    await camPage.evaluate(() => new Promise(r => requestAnimationFrame(r)))
    const atThree = await shotOf(camPage)

    expect(Buffer.compare(atTwo, atThree)).toBe(0) // held, no jump to identity

    // Dedup/rate-limiting is M205's diagnostics scope; here we only assert
    // that the fail-soft path is observable at all, with the right prefix.
    const warnings = await camPage.evaluate(() => window.__warnings)
    const dangling = warnings.filter((w: string) => w.includes('data-focus="#missing"'))
    expect(dangling.length).toBeGreaterThan(0)
    expect(dangling.every((w: string) => w.startsWith('scrolly:'))).toBe(true)
  })

  test('reduced motion snaps to the nearer shot instead of flying', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' })
    const p = await ctx.newPage()
    await serve(p, CAMERA_HTML)

    await settleCameraAt(p, 0, 'one')
    const atShotA = await shotOf(p)
    await settleCameraAt(p, 0.3, 'one') // below the midpoint -> quantizes to shot A
    expect(Buffer.compare(await shotOf(p), atShotA)).toBe(0)

    await settleCameraAt(p, 1, 'two')
    const atShotB = await shotOf(p)
    await settleCameraAt(p, 0.8, 'one') // above the midpoint -> quantizes to shot B
    expect(Buffer.compare(await shotOf(p), atShotB)).toBe(0)

    await ctx.close()
  })

  test('resize re-measures: the endpoint transform changes with the stage', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 800 } })
    const p = await ctx.newPage()
    await serve(p, CAMERA_HTML)
    await settleCameraAt(p, 0, 'one')
    const wide = await cameraTransformOf(p)

    await p.setViewportSize({ width: 800, height: 1600 })
    await p.waitForFunction(() => window.innerWidth === 800)
    // resize re-measures synchronously (no scroll needed) — settle a frame
    await p.evaluate(() => new Promise(r => requestAnimationFrame(r)))
    const tall = await cameraTransformOf(p)

    expect(tall).not.toBe(wide)

    await ctx.close()
  })
})
