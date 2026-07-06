/*
 * §7.4 keyboard stepping: ←/→ move between chapters while a story is on
 * screen; bounds are respected; vertical scroll keys are never touched.
 * Serial on one page — each press starts from where the last one landed.
 */
import { expect, type Page, test } from '@playwright/test'

const FIXTURE = `file://${import.meta.dirname}/fixture.html`

test.describe.configure({ mode: 'serial' })

let page: Page

const activeStep = () =>
  page.evaluate(() => document.querySelector('#story')?.getAttribute('data-active-step'))

// smooth scroll keeps animating past the state flip — wait for scrollY to hold
const settle = () =>
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

const pressAndWait = async (key: string, expected: string) => {
  await page.keyboard.press(key)
  await page.waitForFunction(
    id => document.querySelector('#story')?.getAttribute('data-active-step') === id,
    expected,
    { timeout: 3000 }
  )
  await settle()
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  await page.goto(FIXTURE)
  // land on step a first
  await page.evaluate(() => window.scrollTo(0, 1700))
  await page.waitForFunction(
    () => document.querySelector('#story')?.getAttribute('data-active-step') === 'a',
    undefined,
    { timeout: 3000 }
  )
})

test.afterAll(async () => {
  await page.close()
})

test('ArrowRight steps forward through chapters', async () => {
  await pressAndWait('ArrowRight', 'b')
  await pressAndWait('ArrowRight', 'c')
})

test('ArrowRight at the last step does nothing', async () => {
  await settle()
  const before = await page.evaluate(() => window.scrollY)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(300)
  expect(await activeStep()).toBe('c')
  expect(await page.evaluate(() => window.scrollY)).toBe(before)
})

test('ArrowLeft steps backward', async () => {
  await pressAndWait('ArrowLeft', 'b')
  await pressAndWait('ArrowLeft', 'a')
})

test('keys are ignored while typing in an input', async () => {
  await page.evaluate(() => {
    const input = document.createElement('input')
    input.id = 'field'
    input.style.position = 'fixed' // no layout shift for the steps
    input.style.top = '0'
    document.body.prepend(input)
    input.focus()
  })
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(300)
  expect(await activeStep()).toBe('a')
  await page.evaluate(() => document.getElementById('field')?.remove())
})
