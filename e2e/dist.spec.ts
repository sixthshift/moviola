/*
 * S107 — dist/ packaging: behavioral parity for all three builds against the
 * same fixture geometry as e2e/semantics.spec.ts (viewport 1000×800, trigger
 * at 400, step a top = 2000 → viewport-top 300 at scrollY=1700).
 *
 * Chrome refuses to fetch ES-module scripts from file://, so the esm build's
 * own contract forces an http origin. Instead of a real server, every request
 * to the fake origin is fulfilled from repo files / in-memory fixtures via
 * page.route — no port, no temp dir. iife/min ride along on the same path.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'

const root = path.join(import.meta.dirname, '..')
const ORIGIN = 'http://scrolly.test'

const fixture = (scriptTag: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="/dist/scrolly.css">
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
  iife: `<script src="/dist/scrolly.iife.js"></script>
    <script>window.__story = Scrolly.init('#story')</script>`,
  min: `<script src="/dist/scrolly.min.js"></script>
    <script>window.__story = Scrolly.init('#story')</script>`,
  esm: `<script type="module">
    import Scrolly from '/dist/scrolly.esm.js'
    window.__story = Scrolly.init('#story')
  </script>`,
}

const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
}

const serveFixture = async (page: Page, html: string) => {
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

for (const [name, scriptTag] of Object.entries(builds)) {
  test(`${name} build: step 'a' activates at scrollY=1700`, async ({ page }) => {
    await serveFixture(page, fixture(scriptTag))

    await page.evaluate(y => window.scrollTo(0, y), 1700)
    await page.waitForFunction(
      () => document.querySelector('#story')?.getAttribute('data-active-step') === 'a',
      undefined,
      { timeout: 3000 }
    )

    expect(
      await page.evaluate(() => document.getElementById('a')?.classList.contains('is-active'))
    ).toBe(true)
    expect(
      await page.evaluate(() => document.getElementById('ga')?.classList.contains('is-shown'))
    ).toBe(true)
  })
}

test('min.js is not byte-identical to the iife, is smaller, and drops internal names', () => {
  const iife = readFileSync(path.join(root, 'dist/scrolly.iife.js'), 'utf8')
  const min = readFileSync(path.join(root, 'dist/scrolly.min.js'), 'utf8')
  expect(min).not.toBe(iife)
  expect(min.length).toBeLessThan(iife.length)
  for (const name of ['_engaged', '_onScroll', '_ticking']) {
    expect(min).not.toContain(name)
  }
})

test('esm build exposes a working default export outside a DOM', async () => {
  const m = await import(path.join(root, 'dist/scrolly.esm.js'))
  expect(typeof m.default.init).toBe('function')
})
