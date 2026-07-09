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
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'

declare global {
  interface Window {
    __warnings: string[]
    __events: Array<[string, string, string]>
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

  // §15.6: measureShots re-runs on every resize (§5.3) — the warning must not
  // re-fire each time. Re-visits "three" (already visited once above) twice
  // more and resizes, on the SAME page (serial mode, cumulative __warnings),
  // then asserts the total dangling-selector warning count is still exactly 1.
  test('the dangling data-focus warning never duplicates across repeated scrolls or a resize', async () => {
    await settleCameraAt(camPage, 1, 'two')
    await camPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await camPage.waitForFunction(
      () => document.querySelector('#story')?.getAttribute('data-active-step') === 'three'
    )
    await camPage.evaluate(() => new Promise(r => requestAnimationFrame(r)))

    await settleCameraAt(camPage, 1, 'two')
    await camPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await camPage.waitForFunction(
      () => document.querySelector('#story')?.getAttribute('data-active-step') === 'three'
    )

    await camPage.setViewportSize({ width: 900, height: 700 })
    await camPage.waitForFunction(() => window.innerWidth === 900)
    await camPage.evaluate(() => new Promise(r => requestAnimationFrame(r)))
    await camPage.setViewportSize({ width: 1280, height: 800 })
    await camPage.waitForFunction(() => window.innerWidth === 1280)
    await camPage.evaluate(() => new Promise(r => requestAnimationFrame(r)))

    const warnings = await camPage.evaluate(() => window.__warnings)
    const dangling = warnings.filter((w: string) => w.includes('data-focus="#missing"'))
    expect(dangling).toHaveLength(1)
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

/*
 * §15.3 regression — SPEC "steps without data-focus hold the previous
 * shot" / "never a jump": an unfocused (or dangling) step wedged between
 * two focused steps must show the shot the A -> B flight already ARRIVED
 * at, constant, across its own chapter — never replay that flight. Same
 * anchors and stage geometry as CAMERA_HTML above (see its header for the
 * "zero" buffer step's role), with one extra step inserted between "one"
 * and "two": either bare (no `data-focus`) or carrying a dangling selector.
 */
const holdFixture = (middleStep: string) => `<!doctype html>
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
  ${middleStep}
  <section class="step" id="two" data-focus="#b"><p>two</p></section>
</article>
<div style="height: 1000px"></div>
<script src="/dist/scrolly.min.js"></script>
<script>window.__story = Scrolly.init('#story')</script>
</body>
</html>
`

const HOLD_HTML = holdFixture('<section class="step" id="hold"><p>hold</p></section>')
const DANGLING_HTML = holdFixture(
  '<section class="step" id="hold" data-focus="#missing"><p>hold</p></section>'
)

// Steps, in document order: zero(top 2000) one(3000) hold(4000) two(5000);
// each chapter spans 1000px, trigger at innerHeight*0.5 = 400 (see
// CAMERA_HTML's header for the derivation) — chapter N's scrollY(t) =
// 1600 + N*1000 + t*1000. "one" is chapter 1, "hold" is chapter 2.
const holdScrollYFor = (chapter: number, t: number) => 1600 + chapter * 1000 + t * 1000

const settleHoldAt = async (page: Page, chapter: number, t: number, expectActive: string) => {
  await page.evaluate(y => window.scrollTo(0, y), holdScrollYFor(chapter, t))
  await page.waitForFunction(
    id => document.querySelector('#story')?.getAttribute('data-active-step') === id,
    expectActive,
    { timeout: 3000 }
  )
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)))
}

for (const [label, html] of [
  ['a plain unfocused step', HOLD_HTML],
  ['a step with a dangling data-focus selector', DANGLING_HTML],
] as const) {
  test.describe(`§15.3 camera continuity: ${label} between two focused steps`, () => {
    test.describe.configure({ mode: 'serial' })

    let p: Page

    test.beforeAll(async ({ browser }) => {
      p = await browser.newPage()
      await serve(p, html)
    })

    test.afterAll(async () => {
      await p.close()
    })

    test('holds the arrived shot constant across the whole chapter — no jump, no re-fly', async () => {
      // The trigger crossing a step's top is what activates it (§5.1), so
      // "end of one"/"start of hold" is the SAME instant — chapter 1 at
      // t=1 and chapter 2 at t=0 land on an identical scrollY and both
      // already report "hold" active. Likewise chapter 2's own t=1
      // coincides with "two" activating (its own shot is B too, so the
      // value doesn't change even though the id does).
      await settleHoldAt(p, 1, 1, 'hold') // end of "one": the A -> B flight has landed on B
      const endOfOne = await shotOf(p)

      await settleHoldAt(p, 2, 0, 'hold') // start of "hold"
      const startOfHold = await shotOf(p)
      await settleHoldAt(p, 2, 0.5, 'hold') // middle of "hold"
      const midHold = await shotOf(p)
      await settleHoldAt(p, 2, 1, 'two') // end of "hold"
      const endOfHold = await shotOf(p)

      expect(Buffer.compare(startOfHold, endOfOne)).toBe(0)
      expect(Buffer.compare(midHold, endOfOne)).toBe(0)
      expect(Buffer.compare(endOfHold, endOfOne)).toBe(0)

      // Denser sampling across the interior of the chapter: never a moment
      // of re-flown motion, not just agreement at the three checkpoints
      // above.
      for (const t of [0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9]) {
        await settleHoldAt(p, 2, t, 'hold')
        expect(Buffer.compare(await shotOf(p), endOfOne)).toBe(0)
      }
    })
  })
}

test.describe('§15.3 camera continuity: reduced motion mid-hold', () => {
  test('reduced motion at the middle of a hold step shows the shot the earlier flight already arrived at', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' })
    const p = await ctx.newPage()
    await serve(p, HOLD_HTML)

    await settleHoldAt(p, 1, 1, 'hold') // end of "one" (== start of "hold"): arrived at B
    const endOfOne = await shotOf(p)

    await settleHoldAt(p, 2, 0.5, 'hold') // middle of "hold"
    const midHold = await shotOf(p)

    expect(Buffer.compare(midHold, endOfOne)).toBe(0)

    await ctx.close()
  })
})

/*
 * §15.4 data-morph — proven against real Chromium View Transitions, not just
 * the stubbed unit tests (test/unit/story.test.ts owns the deterministic,
 * scheduler-independent guarantees). Fixture: three named squares whose flex
 * `order` is driven purely by `[data-active-step]` — the exact §5.2 write
 * data-morph wraps. Three sequential 1000px steps directly after a 2000px
 * spacer (no leading buffer, same geometry recipe as this file's §15.2
 * fixture): tops 2000/3000/4000, trigger 400, so
 *
 *   scrollY(step, t) = 1600 + step*1000 + t*1000
 */
const MORPH_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/dist/scrolly.css">
<style>
  body { margin: 0; }
  #spacer { height: 2000px; }
  .scrolly > .step { min-height: 0; height: 1000px; margin: 0; }
  .rack { display: flex; gap: 12px; }
  .dot { width: 60px; height: 60px; }
  .dot-a { background: #e33333; view-transition-name: dot-a; order: var(--order-a, 1); }
  .dot-b { background: #33aa77; view-transition-name: dot-b; order: var(--order-b, 2); }
  .dot-c { background: #3377ee; view-transition-name: dot-c; order: var(--order-c, 3); }
  .scrolly[data-active-step="one"] .rack { --order-a: 1; --order-b: 2; --order-c: 3; }
  .scrolly[data-active-step="two"] .rack { --order-a: 3; --order-b: 1; --order-c: 2; }
  .scrolly[data-active-step="three"] .rack { --order-a: 2; --order-b: 3; --order-c: 1; }
</style>
</head>
<body>
<script>window.__events = []</script>
<div id="spacer"></div>
<article id="story" class="scrolly" data-layout="side-right" data-morph>
  <figure>
    <div class="rack">
      <div class="dot dot-a"></div>
      <div class="dot dot-b"></div>
      <div class="dot dot-c"></div>
    </div>
  </figure>
  <section class="step" id="one"><p>one</p></section>
  <section class="step" id="two"><p>two</p></section>
  <section class="step" id="three"><p>three</p></section>
</article>
<div style="height: 1000px"></div>
<script src="/dist/scrolly.min.js"></script>
<script>
  window.__story = Scrolly.init('#story')
  window.__story.on('stepenter', d => window.__events.push(['enter', d.id, d.direction]))
  window.__story.on('stepexit', d => window.__events.push(['exit', d.id, d.direction]))
</script>
</body>
</html>
`

const morphScrollYFor = (step: number, t = 0) => 1600 + step * 1000 + t * 1000

const settleMorphAt = async (page: Page, step: number, expectActive: string) => {
  await page.evaluate(y => window.scrollTo(0, y), morphScrollYFor(step))
  await page.waitForFunction(
    id => document.querySelector('#story')?.getAttribute('data-active-step') === id,
    expectActive,
    { timeout: 3000 }
  )
}

const rackShot = (page: Page) => page.locator('#story .rack').screenshot()

test.describe('§15.4 data-morph (real View Transitions)', () => {
  test('stepexit/stepenter fire in the existing order without waiting on the transition', async ({
    browser,
  }) => {
    const p = await (await browser.newContext()).newPage()
    await serve(p, MORPH_HTML)
    await settleMorphAt(p, 0, 'one')
    await p.evaluate(() => {
      window.__events.length = 0
    })

    await p.evaluate(y => window.scrollTo(0, y), morphScrollYFor(1))
    // Polls fast; if events were gated behind the transition's `finished`
    // promise (default ~250ms animation) this would not resolve this quickly.
    await p.waitForFunction(() => window.__events.length >= 2, undefined, { timeout: 1000 })
    const events = await p.evaluate(() => window.__events)
    expect(events).toEqual([
      ['exit', 'one', 'down'],
      ['enter', 'two', 'down'],
    ])

    // The write itself still lands correctly once the transition runs.
    await p.waitForFunction(
      () => document.querySelector('#story')?.getAttribute('data-active-step') === 'two',
      undefined,
      { timeout: 3000 }
    )
  })

  test('a mid-flight frame differs from both endpoints — a real flight, not a cut', async ({
    browser,
  }) => {
    const p = await (await browser.newContext()).newPage()
    await serve(p, MORPH_HTML)
    await settleMorphAt(p, 0, 'one')
    await p.waitForTimeout(300) // let step "one"'s own arrival settle first
    const start = await rackShot(p)

    await p.evaluate(y => window.scrollTo(0, y), morphScrollYFor(1))
    await p.waitForFunction(
      () => document.querySelector('#story')?.getAttribute('data-active-step') === 'two',
      undefined,
      { timeout: 3000 }
    )
    await p.waitForTimeout(50) // sample mid-animation (default transition ~250ms)
    const mid = await rackShot(p)

    await p.waitForTimeout(500) // let the transition fully finish
    const end = await rackShot(p)

    expect(Buffer.compare(mid, start)).not.toBe(0)
    expect(Buffer.compare(mid, end)).not.toBe(0)
  })

  test('a step-change mid-flight skips the running transition: latest step wins, never a stale one', async ({
    browser,
  }) => {
    const p = await (await browser.newContext()).newPage()
    await serve(p, MORPH_HTML)
    await settleMorphAt(p, 0, 'one')

    // Fire both step-changes before either transition has had time to finish.
    await p.evaluate(y => window.scrollTo(0, y), morphScrollYFor(1))
    await p.evaluate(y => window.scrollTo(0, y), morphScrollYFor(2))
    await p.waitForFunction(
      () => document.querySelector('#story')?.getAttribute('data-active-step') === 'three',
      undefined,
      { timeout: 3000 }
    )
    await p.waitForTimeout(500) // let it fully settle
    const rushed = await rackShot(p)

    // Compare against a fresh page driven straight to "three" the slow way.
    const p2 = await (await browser.newContext()).newPage()
    await serve(p2, MORPH_HTML)
    await settleMorphAt(p2, 2, 'three')
    await p2.waitForTimeout(500)
    const direct = await rackShot(p2)

    expect(Buffer.compare(rushed, direct)).toBe(0)
  })

  test('API-absent stub: with document.startViewTransition removed, the batch lands exactly as before', async ({
    browser,
  }) => {
    const ctx = await browser.newContext()
    await ctx.addInitScript(() => {
      delete (window.document as { startViewTransition?: unknown }).startViewTransition
    })
    const p = await ctx.newPage()
    await serve(p, MORPH_HTML)

    await p.evaluate(y => window.scrollTo(0, y), morphScrollYFor(0))
    await p.waitForFunction(
      () => document.querySelector('#story')?.getAttribute('data-active-step') === 'one',
      undefined,
      { timeout: 1000 } // no transition to wait on: settles immediately
    )
    await ctx.close()
  })

  test('reduced motion: data-morph is inert even though the API exists', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' })
    const p = await ctx.newPage()
    await serve(p, MORPH_HTML)

    await p.evaluate(y => window.scrollTo(0, y), morphScrollYFor(0))
    await p.waitForFunction(
      () => document.querySelector('#story')?.getAttribute('data-active-step') === 'one',
      undefined,
      { timeout: 1000 } // no transition to wait on: settles immediately
    )
    await ctx.close()
  })
})

test.describe('§15.4 morph-regroup fixture — the §14 validator', () => {
  test('validator: 4 distinct graphic states, bidirectionally consistent under non-monotonic traversal', () => {
    const fixture = path.join(import.meta.dirname, 'fixtures-clean/morph-regroup.html')
    const result = spawnSync(
      'node',
      [path.join(root, 'scripts/validate-story.mjs'), fixture, '--tier1'],
      { encoding: 'utf8' }
    )
    const report = JSON.parse(result.stdout)
    expect(result.status).toBe(0)
    expect(report.pass).toBe(true)
    const story = report.stories[0]
    expect(story.stepCount).toBeGreaterThanOrEqual(4)
    expect(story.distinctGraphicStates).toBeGreaterThanOrEqual(4)
    expect(story.bidirectionalConsistent).toBe(true)
    expect(story.glueTier).toBe('tier1')
    expect(story.externalUrls).toEqual([])
    expect(story.consoleErrors).toEqual([])
  })
})

/*
 * §15.6 gallery sweep — every shipped page, loaded for real and scrolled
 * top to bottom (plus a resize), must never print a `scrolly:` diagnostic.
 * This doubles as a referential-integrity check on the gallery itself: a
 * real dangling data-show/data-scrub/data-focus token or an unused
 * data-camera rig in an example is a genuine authoring bug this sweep would
 * catch — fixing any such example is out of scope for M205 (report only).
 */
const galleryPages = [
  'index.html',
  ...readdirSync(path.join(root, 'examples'))
    .filter(f => f.endsWith('.html'))
    .sort()
    .map(f => `examples/${f}`),
]

test.describe('§15.6 gallery sweep: zero scrolly: warnings', () => {
  for (const rel of galleryPages) {
    test(`${rel} produces zero scrolly: warnings while scrolling through`, async ({ browser }) => {
      const p = await (await browser.newContext()).newPage()
      const warnings: string[] = []
      p.on('console', msg => {
        if (msg.type() === 'warning' && msg.text().startsWith('scrolly:')) warnings.push(msg.text())
      })

      await p.goto(`file://${path.join(root, rel)}`)

      const height = await p.evaluate(() => document.documentElement.scrollHeight)
      const samples = 24
      for (let i = 0; i <= samples; i++) {
        await p.evaluate(y => window.scrollTo(0, y), Math.round((height * i) / samples))
        await p.evaluate(() => new Promise(r => requestAnimationFrame(r)))
      }

      // A resize re-measures the camera (§5.3) — must not duplicate any
      // warning already fired during the scroll above (§15.6 idempotency).
      await p.setViewportSize({ width: 900, height: 700 })
      await p.evaluate(() => new Promise(r => requestAnimationFrame(r)))
      await p.setViewportSize({ width: 1280, height: 800 })
      await p.evaluate(() => new Promise(r => requestAnimationFrame(r)))

      expect(warnings).toEqual([])
      await p.close()
    })
  }
})
