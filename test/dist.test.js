/*
 * S107 — dist/ packaging: behavioral parity for all three builds against the
 * same fixture geometry as test/semantics.test.js (viewport 1000×800, trigger
 * at 400, step a top = 2000 → viewport-top 300 at scrollY=1700).
 *
 * Served over a local HTTP server rather than file:// — Chrome refuses to
 * fetch ES module scripts (type=module) from the file: scheme at all, so
 * the esm build's own contract forces http for this suite; iife/min ride
 * along on the same server for one code path.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test'
import { gzipSync } from 'bun'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const root = path.join(import.meta.dir, '..')

const fixture = scriptTag => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/src/scrolly.css">
<style>
  body { margin: 0; }
  #spacer { height: 2000px; }
  .scrolly > .step { min-height: 0; height: 1000px; margin: 0; }
  #b { margin-bottom: 500px; }
</style>
</head>
<body>
<div id="spacer"></div>

<article id="story" class="scrolly" data-layout="side-right">
  <figure>
    <div data-show="a" id="ga">graphic A</div>
    <div data-show="b c" id="gbc">graphic BC</div>
  </figure>
  <section class="step" id="a"><p>step a</p></section>
  <section class="step" id="b"><p>step b</p></section>
  <section class="step" id="c"><p>step c</p></section>
</article>

<div style="height: 1000px"></div>

${scriptTag}
</body>
</html>
`

const builds = {
  iife: () => `<script src="/dist/scrolly.iife.js"></script>
    <script>window.__story = Scrolly.init('#story')</script>`,
  min: () => `<script src="/dist/scrolly.min.js"></script>
    <script>window.__story = Scrolly.init('#story')</script>`,
  esm: () => `<script type="module">
    import Scrolly from '/dist/scrolly.esm.js'
    window.Scrolly = Scrolly
    window.__story = Scrolly.init('#story')
  </script>`
}

let browser, server, dir

beforeAll(async () => {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  dir = mkdtempSync(path.join(tmpdir(), 'scrolly-dist-test-'))
  server = Bun.serve({
    port: 0,
    async fetch (req) {
      const pathname = new URL(req.url).pathname
      const base = pathname.startsWith('/fixture/') ? dir : root
      const rel = pathname.startsWith('/fixture/') ? pathname.slice('/fixture/'.length) : pathname.slice(1)
      const file = Bun.file(path.join(base, rel))
      if (!(await file.exists())) return new Response('not found', { status: 404 })
      return new Response(file)
    }
  })
})

afterAll(async () => {
  await browser?.close()
  server?.stop()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

for (const [name, scriptTag] of Object.entries(builds)) {
  test(`${name} build: step 'a' activates at scrollY=1700`, async () => {
    writeFileSync(path.join(dir, `${name}.html`), fixture(scriptTag()))

    const page = await browser.newPage()
    await page.setViewport({ width: 1000, height: 800 })
    await page.goto(`http://localhost:${server.port}/fixture/${name}.html`)

    await page.evaluate(y => window.scrollTo(0, y), 1700)
    await page.waitForFunction(
      () => document.querySelector('#story').getAttribute('data-active-step') === 'a',
      { timeout: 3000 }
    )

    const activeStep = await page.evaluate(() =>
      document.querySelector('#story').getAttribute('data-active-step'))
    const aActive = await page.evaluate(() =>
      document.getElementById('a').classList.contains('is-active'))
    const gaShown = await page.evaluate(() =>
      document.getElementById('ga').classList.contains('is-shown'))

    expect(activeStep).toBe('a')
    expect(aActive).toBe(true)
    expect(gaShown).toBe(true)

    await page.close()
  })
}

test('min.js is not byte-identical to src, is smaller, and drops internal names', async () => {
  const src = await Bun.file(path.join(root, 'src/scrolly.js')).text()
  const min = await Bun.file(path.join(root, 'dist/scrolly.min.js')).text()
  expect(min).not.toBe(src)
  expect(min.length).toBeLessThan(src.length)
  for (const name of ['_engaged', '_onScroll', '_ticking']) {
    expect(min).not.toContain(name)
  }
})

test('min.js gzip size ≤ 4096 bytes', async () => {
  const min = gzipSync(await Bun.file(path.join(root, 'dist/scrolly.min.js')).arrayBuffer())
  expect(min.length).toBeLessThanOrEqual(4096)
})

test('esm build exposes a working default export outside a DOM', async () => {
  const m = await import(path.join(root, 'dist/scrolly.esm.js'))
  expect(typeof m.default.init).toBe('function')
})
