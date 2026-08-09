/*
 * README's two shipped recipes, running as real pages.
 *
 * Each recipe's markup exists twice on purpose — once inside a README fence,
 * once verbatim inside `e2e/fixtures-clean/recipe-*.html` — and this spec is
 * what makes the second copy worth having: a published recipe that stops
 * initializing, or that starts tripping a `moviola:` diagnostic, fails here
 * instead of in a reader's browser.
 *
 * What is asserted is deliberately narrow: silence, and a story that really
 * ran. The camera recipe's framing math belongs to e2e/focus-coords.spec.ts
 * and e2e/shot-framings.spec.ts, and the scrub timeline to
 * e2e/motion.spec.ts — re-asserting either here would make this suite a
 * second, drifting copy of those contracts. What it does own is the failure
 * those specs cannot see: an inert page passing by emitting nothing. Hence
 * `is-ready`, plus every chapter activating in order as the page scrolls,
 * plus a `--story-progress` that moved.
 */
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'

const root = path.join(import.meta.dirname, '..')
const fixture = (name: string) => `file://${path.join(root, 'e2e/fixtures-clean', name)}`

const CAMERA_RECIPE = 'recipe-svg-image-camera.html'

const RECIPES = [
  { title: 'a photo as the camera stage', file: CAMERA_RECIPE, steps: ['coast', 'jetty', 'hut'] },
  {
    title: 'scrubbing one chapter',
    file: 'recipe-scrub-teaching.html',
    steps: ['calm', 'rising', 'after'],
  },
] as const

type Recorded = { warnings: string[]; errors: string[]; pageErrors: string[] }

/** Everything the page said, so a test can assert on what it did NOT say too. */
const recordConsole = (page: Page): Recorded => {
  const record: Recorded = { warnings: [], errors: [], pageErrors: [] }
  page.on('console', msg => {
    if (msg.type() === 'warning') record.warnings.push(msg.text())
    if (msg.type() === 'error') record.errors.push(msg.text())
  })
  page.on('pageerror', err => record.pageErrors.push(err.message))
  return record
}

const moviolaWarnings = (record: Recorded) => record.warnings.filter(w => w.startsWith('moviola:'))

/*
 * Top to bottom in quarter-viewport stops, two frames each (the runtime
 * batches its work into a rAF, §5.1), returning the chapters that went active
 * along the way. A stride shorter than a chapter is what makes every shot and
 * every scrub actually resolve — a single jump to the bottom would exercise
 * only the last one, and it is a middle chapter that a bad `data-focus` or
 * `data-scrub` token warns from.
 */
const scrollWholeStory = (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const frame = () => new Promise(r => requestAnimationFrame(r))
    const story = document.querySelector('.moviola') as HTMLElement
    const bottom = () => document.documentElement.scrollHeight - window.innerHeight
    const visited: string[] = []
    const stop = async (y: number) => {
      window.scrollTo(0, y)
      await frame()
      await frame()
      const id = story.getAttribute('data-active-step')
      if (id && visited[visited.length - 1] !== id) visited.push(id)
    }

    for (let y = 0; y < bottom(); y += window.innerHeight / 4) await stop(y)
    await stop(bottom())
    return visited
  })

type StoryState = { ready: boolean; active: string | null; storyProgress: number }

const storyState = (page: Page): Promise<StoryState> =>
  page.evaluate(() => {
    const story = document.querySelector('.moviola') as HTMLElement
    return {
      ready: story.classList.contains('is-ready'),
      active: story.getAttribute('data-active-step'),
      storyProgress: Number.parseFloat(
        getComputedStyle(story).getPropertyValue('--story-progress')
      ),
    }
  })

const settled = (page: Page) =>
  page.waitForFunction(() => {
    const story = document.querySelector('.moviola')
    return story?.classList.contains('is-ready') && story.getAttribute('data-active-step') !== null
  })

for (const recipe of RECIPES) {
  test.describe(`README recipe: ${recipe.title}`, () => {
    test.describe.configure({ mode: 'serial' })

    let page: Page
    let record: Recorded

    test.beforeAll(async ({ browser }) => {
      page = await browser.newPage()
      record = recordConsole(page)
      await page.goto(fixture(recipe.file))
    })

    test.afterAll(async () => {
      await page.close()
    })

    test('the story initializes: is-ready, and the first chapter is active', async () => {
      await settled(page)
      const state = await storyState(page)
      expect(state.ready).toBe(true)
      expect(state.active).toBe(recipe.steps[0])
    })

    test('every chapter activates in document order as the page scrolls', async () => {
      const top = await storyState(page)
      const visited = await scrollWholeStory(page)
      const bottom = await storyState(page)

      expect(visited).toEqual([...recipe.steps])
      expect(bottom.active).toBe(recipe.steps[recipe.steps.length - 1])
      expect(bottom.storyProgress).toBeGreaterThan(top.storyProgress)
    })

    test('nothing on the console: no moviola: warn, no error, no page throw', () => {
      expect(moviolaWarnings(record)).toEqual([])
      expect(record.errors).toEqual([])
      expect(record.pageErrors).toEqual([])
    })
  })
}

/*
 * The camera recipe's whole claim is that a raster can be the stage — that
 * `<svg><image>` under `[data-camera]` is moviola's answer to "can the camera
 * work on a photo". A page that framed nothing would satisfy every assertion
 * above, so this one insists the transform resolved.
 */
test('the photo recipe puts a resolved camera transform on its stage', async ({ browser }) => {
  const page = await browser.newPage()
  const record = recordConsole(page)
  await page.goto(fixture(CAMERA_RECIPE))
  await settled(page)
  await scrollWholeStory(page)

  const transform = await page.evaluate(() => {
    const camera = document.querySelector('[data-camera]') as SVGGraphicsElement
    return getComputedStyle(camera).transform
  })
  expect(transform).not.toBe('none')
  expect(transform).not.toBe('')

  expect(moviolaWarnings(record)).toEqual([])
  expect(record.pageErrors).toEqual([])

  await page.close()
})
