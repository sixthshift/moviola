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
