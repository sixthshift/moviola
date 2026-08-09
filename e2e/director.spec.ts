/*
 * SPEC §15.6.2 — moviola-director.js, the authoring overlay: trigger line,
 * chapter rail, state chip. Loaded via addScriptTag so the shared fixtures
 * stay byte-untouched; the director is a dev-only add-on, never baked into
 * a page (see ticket M207 — zero diffs to core files).
 */
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'

const FIXTURE = `file://${import.meta.dirname}/fixture.html`
const DIRECTOR = path.join(import.meta.dirname, '../moviola-director.js')

const line = (page: Page) => page.locator('[data-moviola-director-line]')
const rail = (page: Page) => page.locator('[data-moviola-director-rail]')
const chip = (page: Page) => page.locator('[data-moviola-director-chip]')

const lineTop = (page: Page) => line(page).evaluate(el => el.getBoundingClientRect().top)

const activeStep = (page: Page) =>
  page.evaluate(() => document.querySelector('#story')?.getAttribute('data-active-step'))

// smooth scroll keeps animating past the state flip — wait for scrollY to hold
const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>(resolve => {
        let last = window.scrollY
        let still = 0
        const tick = () => {
          still = window.scrollY === last ? still + 1 : 0
          last = window.scrollY
          still >= 5 ? resolve() : requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
  )

test('trigger line sits at innerHeight × the default offset (0.5)', async ({ page }) => {
  await page.goto(FIXTURE)
  await page.addScriptTag({ path: DIRECTOR })
  const top = await lineTop(page)
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('no viewport')
  expect(top).toBeGreaterThanOrEqual(viewport.height * 0.5 - 1)
  expect(top).toBeLessThanOrEqual(viewport.height * 0.5 + 1)
})

test('trigger line follows a custom data-offset', async ({ page }) => {
  await page.goto(FIXTURE)
  await page.evaluate(() => document.querySelector('#story')?.setAttribute('data-offset', '0.25'))
  await page.addScriptTag({ path: DIRECTOR })
  const top = await lineTop(page)
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('no viewport')
  expect(top).toBeGreaterThanOrEqual(viewport.height * 0.25 - 1)
  expect(top).toBeLessThanOrEqual(viewport.height * 0.25 + 1)
})

test('rail click scrolls the clicked step to the trigger and activates it', async ({ page }) => {
  await page.goto(FIXTURE)
  await page.addScriptTag({ path: DIRECTOR })
  await rail(page).locator('button[data-step-id="b"]').click()
  await page.waitForFunction(
    () => document.querySelector('#story')?.getAttribute('data-active-step') === 'b',
    undefined,
    { timeout: 3000 }
  )
  await settle(page)
  expect(await activeStep(page)).toBe('b')
})

test('reduced motion makes a rail click jump instantly (no smooth behavior)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(FIXTURE)
  await page.addScriptTag({ path: DIRECTOR })
  await page.evaluate(() => {
    ;(window as unknown as { __scrollToCalls: ScrollToOptions[] }).__scrollToCalls = []
    const native = window.scrollTo.bind(window)
    // biome-ignore lint/suspicious/noExplicitAny: test-only instrumentation shim
    window.scrollTo = ((opts: any) => {
      ;(window as unknown as { __scrollToCalls: ScrollToOptions[] }).__scrollToCalls.push(opts)
      native(opts)
    }) as typeof window.scrollTo
  })
  await rail(page).locator('button[data-step-id="c"]').click()
  const calls = await page.evaluate(
    () => (window as unknown as { __scrollToCalls: ScrollToOptions[] }).__scrollToCalls
  )
  expect(calls.length).toBeGreaterThan(0)
  expect(calls[calls.length - 1]?.behavior).toBe('auto')
})

test("'d' toggles the overlay off, leaving zero injected nodes", async ({ page }) => {
  await page.goto(FIXTURE)
  await page.addScriptTag({ path: DIRECTOR })
  await expect(line(page)).toHaveCount(1)
  await expect(rail(page)).toHaveCount(1)
  await expect(chip(page)).toHaveCount(1)

  await page.keyboard.press('d')

  await expect(page.locator('[data-moviola-director]')).toHaveCount(0)
  await expect(line(page)).toHaveCount(0)
  await expect(rail(page)).toHaveCount(0)
  await expect(chip(page)).toHaveCount(0)
})

test('typing "d" inside an input does not toggle the overlay', async ({ page }) => {
  await page.goto(FIXTURE)
  await page.addScriptTag({ path: DIRECTOR })
  await page.evaluate(() => {
    const input = document.createElement('input')
    input.id = 'field'
    document.body.prepend(input)
    input.focus()
  })
  await page.locator('#field').pressSequentially('d')
  await expect(line(page)).toHaveCount(1)
  await page.evaluate(() => document.getElementById('field')?.remove())
})

test('loading on a page with zero stories is a no-op — no nodes, no console errors', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  await page.setContent('<!doctype html><html><body></body></html>')
  await page.addScriptTag({ path: DIRECTOR })
  await page.keyboard.press('d')
  expect(errors).toEqual([])
  expect(await page.locator('[data-moviola-director]').count()).toBe(0)
})
