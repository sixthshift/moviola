/*
 * The SPEC made executable: §5 state-machine semantics, §7 API, §8.1 no-JS —
 * asserted against real Chromium over e2e/fixture.html (which loads the dist
 * build: we test what ships). The §3 size budget lives in test/unit/size.
 *
 * Fixture geometry: viewport 1000×800 → trigger line at 400.
 * Document tops: step a=2000, b=3000, c=4500 (500px gap after b).
 *
 * Tests are serial on one page: each scroll position builds on the last, and
 * the recorded event log is cumulative by design.
 */
import { expect, type Page, test } from '@playwright/test'

declare global {
  interface Window {
    __events: [string, string, string][]
    __story: { destroy(): void }
    Scrolly: { init(target: string): unknown }
  }
}

const FIXTURE = `file://${import.meta.dirname}/fixture.html`

test.describe.configure({ mode: 'serial' })

let page: Page

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  await page.goto(FIXTURE)
})

test.afterAll(async () => {
  await page.close()
})

const snapshot = () =>
  page.evaluate(() => {
    const root = document.querySelector('#story') as HTMLElement
    const cls = (id: string) =>
      [...(document.getElementById(id) as HTMLElement).classList]
        .filter(c => c.startsWith('is-'))
        .sort()
        .join(' ')
    return {
      ready: root.classList.contains('is-ready'),
      activeStep: root.getAttribute('data-active-step'),
      a: cls('a'),
      b: cls('b'),
      c: cls('c'),
      ga: (document.getElementById('ga') as HTMLElement).classList.contains('is-shown'),
      gbc: (document.getElementById('gbc') as HTMLElement).classList.contains('is-shown'),
      stepProgress: parseFloat(root.style.getPropertyValue('--step-progress')),
      storyProgress: parseFloat(root.style.getPropertyValue('--story-progress')),
      events: window.__events.slice(),
    }
  })

const scrollToAndSettle = async (y: number, expectActive: string) => {
  await page.evaluate(y => window.scrollTo(0, y), y)
  await page.waitForFunction(
    id => document.querySelector('#story')?.getAttribute('data-active-step') === id,
    expectActive,
    { timeout: 3000 }
  )
  // one extra frame so progress vars from the same update are flushed
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)))
}

test('§8.1 no-JS: page readable, graphic states visible', async ({ browser }) => {
  const nojs = await browser.newContext({ javaScriptEnabled: false })
  const p = await nojs.newPage()
  await p.goto(FIXTURE)
  const opacity = await p.evaluate(
    () => getComputedStyle(document.getElementById('ga') as HTMLElement).opacity
  )
  expect(opacity).toBe('1')
  await nojs.close()
})

test('§5.1 initial state: before the first step, nothing is active', async () => {
  const s = await snapshot()
  expect(s.ready).toBe(true)
  expect(s.activeStep).toBe(null)
  expect(s.a).toBe('is-future')
  expect(s.b).toBe('is-future')
  expect(s.c).toBe('is-future')
  expect(s.ga).toBe(false)
  expect(s.gbc).toBe(false)
  expect(s.events).toEqual([])
})

test('§5.1/§5.2 step a activates when its top crosses the trigger', async () => {
  await scrollToAndSettle(1700, 'a') // a viewport-top = 300 ≤ 400
  const s = await snapshot()
  expect(s.a).toBe('is-active')
  expect(s.b).toBe('is-future')
  expect(s.ga).toBe(true)
  expect(s.gbc).toBe(false)
  // chapter a: top 300 → next top 1300; (400-300)/1000
  expect(s.stepProgress).toBeCloseTo(0.1, 2)
  // story: first top 300 → last bottom 3800; (400-300)/3500
  expect(s.storyProgress).toBeCloseTo(0.0286, 2)
  expect(s.events).toEqual([['enter', 'a', 'down']])
})

test('§5.1/§5.2 step b: classes, data-show list membership, chapter progress over the gap', async () => {
  await scrollToAndSettle(2650, 'b') // b viewport-top = 350
  const s = await snapshot()
  expect(s.a).toBe('is-past')
  expect(s.b).toBe('is-active')
  expect(s.c).toBe('is-future')
  expect(s.ga).toBe(false)
  expect(s.gbc).toBe(true) // data-show="b c" matches b
  // chapter b spans b.top → c.top = 1500 (includes the 500px gap): 50/1500
  expect(s.stepProgress).toBeCloseTo(0.0333, 2)
  expect(s.events).toEqual([
    ['enter', 'a', 'down'],
    ['exit', 'a', 'down'],
    ['enter', 'b', 'down'],
  ])
})

test('§5.1 gap between steps: the earlier step stays active', async () => {
  await scrollToAndSettle(4050, 'b') // c viewport-top = 450 > 400 → still b
  const s = await snapshot()
  expect(s.b).toBe('is-active')
  expect(s.c).toBe('is-future')
  expect(s.gbc).toBe(true)
})

test('§5.1 last step activates; data-show carries across b→c', async () => {
  await scrollToAndSettle(4200, 'c') // c viewport-top = 300
  const s = await snapshot()
  expect(s.b).toBe('is-past')
  expect(s.c).toBe('is-active')
  expect(s.gbc).toBe(true) // still shown: data-show="b c"
  // last chapter uses its own bottom: (400-300)/1000
  expect(s.stepProgress).toBeCloseTo(0.1, 2)
})

test('§5.1 reverse scroll: exact mirror, direction=up', async () => {
  await scrollToAndSettle(1700, 'a')
  const s = await snapshot()
  expect(s.a).toBe('is-active')
  expect(s.b).toBe('is-future')
  expect(s.c).toBe('is-future')
  expect(s.ga).toBe(true)
  expect(s.gbc).toBe(false)
  expect(s.events.slice(-2)).toEqual([
    ['exit', 'c', 'up'],
    ['enter', 'a', 'up'],
  ])
})

test('§7.2 init is idempotent per element', async () => {
  const same = await page.evaluate(() => window.Scrolly.init('#story') === window.__story)
  expect(same).toBe(true)
})

test('§7.2/§7.3 destroy restores the DOM; re-init works fresh', async () => {
  const after = await page.evaluate(() => {
    window.__story.destroy()
    const root = document.querySelector('#story') as HTMLElement
    return {
      ready: root.classList.contains('is-ready'),
      activeStep: root.getAttribute('data-active-step'),
      classes: [...document.querySelectorAll('.step')].flatMap(s =>
        [...s.classList].filter(c => c.startsWith('is-'))
      ),
      shown: document.querySelectorAll('.is-shown').length,
      stepProgress: root.style.getPropertyValue('--step-progress'),
    }
  })
  expect(after.ready).toBe(false)
  expect(after.activeStep).toBe(null)
  expect(after.classes).toEqual([])
  expect(after.shown).toBe(0)
  expect(after.stepProgress).toBe('')

  const fresh = await page.evaluate(() => {
    const s = window.Scrolly.init('#story')
    return (
      s !== window.__story &&
      (document.querySelector('#story') as HTMLElement).classList.contains('is-ready')
    )
  })
  expect(fresh).toBe(true)
})
