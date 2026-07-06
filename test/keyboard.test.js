/*
 * §7.4 keyboard stepping: ←/→ move between chapters while a story is on
 * screen; bounds are respected; vertical scroll keys are never touched.
 */
import { test, expect, beforeAll, afterAll } from 'bun:test'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const FIXTURE = `file://${import.meta.dir}/fixture.html`

let browser, page

const activeStep = () => page.evaluate(() =>
  document.querySelector('#story').getAttribute('data-active-step'))

const settle = () => page.evaluate(() => new Promise(resolve => {
  let last = window.scrollY, still = 0
  const tick = () => {
    still = window.scrollY === last ? still + 1 : 0
    last = window.scrollY
    still >= 5 ? resolve() : requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}))

const pressAndWait = async (key, expected) => {
  await page.keyboard.press(key)
  await page.waitForFunction(
    id => document.querySelector('#story').getAttribute('data-active-step') === id,
    { timeout: 3000 },
    expected
  )
  await settle() // smooth scroll keeps animating past the state flip
}

beforeAll(async () => {
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  page = await browser.newPage()
  await page.setViewport({ width: 1000, height: 800 })
  await page.goto(FIXTURE)
  // land on step a first
  await page.evaluate(() => window.scrollTo(0, 1700))
  await page.waitForFunction(
    () => document.querySelector('#story').getAttribute('data-active-step') === 'a',
    { timeout: 3000 })
})

afterAll(async () => {
  await browser?.close()
})

test('ArrowRight steps forward through chapters', async () => {
  await pressAndWait('ArrowRight', 'b')
  await pressAndWait('ArrowRight', 'c')
})

test('ArrowRight at the last step does nothing', async () => {
  await settle()
  const before = await page.evaluate(() => window.scrollY)
  await page.keyboard.press('ArrowRight')
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)))
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
  await page.evaluate(() => new Promise(r => setTimeout(r, 300)))
  expect(await activeStep()).toBe('a')
  await page.evaluate(() => document.getElementById('field').remove())
})
