// @vitest-environment happy-dom
/*
 * The Story state machine driven headlessly: IntersectionObserver and
 * getBoundingClientRect are stubbed so §5/§7 transitions can be asserted
 * without a browser. Real scrolling (sticky frames, rAF timing, no-JS
 * degradation) is the e2e suite's job — this file owns the pure DOM-state
 * contract.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import Scrolly from '../../src/index'
import type { StepEventDetail } from '../../src/types'

/* ---- test doubles -------------------------------------------------------- */

class IOStub {
  static instances: IOStub[] = []
  callback: IntersectionObserverCallback
  observed: Element[] = []
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb
    IOStub.instances.push(this)
  }
  observe(el: Element) {
    this.observed.push(el)
  }
  disconnect() {}
  /** Fire the observer as if the story scrolled on/off screen. */
  fire(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    )
  }
}

/** Give an element a fixed viewport-relative rect. */
const setRect = (el: HTMLElement, top: number, bottom: number) => {
  el.getBoundingClientRect = () =>
    ({ top, bottom, height: bottom - top, left: 0, right: 0, width: 0 }) as DOMRect
}

/* ---- fixture ------------------------------------------------------------- */
// Viewport 800 high, offset 0.5 → trigger line at 400.

let root: HTMLElement
let steps: HTMLElement[]
let graphicA: HTMLElement
let graphicBC: HTMLElement

const buildStory = () => {
  document.body.innerHTML = `
    <article class="scrolly">
      <figure>
        <div id="ga" data-show="a"></div>
        <div id="gbc" data-show="b c"></div>
      </figure>
      <section class="step" id="a"></section>
      <section class="step" id="b"></section>
      <section class="step"></section>
    </article>`
  root = document.querySelector('.scrolly') as HTMLElement
  steps = [...document.querySelectorAll<HTMLElement>('.step')]
  graphicA = document.getElementById('ga') as HTMLElement
  graphicBC = document.getElementById('gbc') as HTMLElement
}

/** Position the steps so `crossed` of them have tops above the trigger (400). */
const scrollToStep = (crossed: number) => {
  steps.forEach((s, i) => {
    const top = 400 + (i - crossed) * 1000 // crossed step sits exactly on the trigger
    setRect(s, top, top + 900)
  })
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', IOStub)
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
  IOStub.instances = []
  buildStory()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/* ---- init ---------------------------------------------------------------- */

describe('init', () => {
  test('stamps every step is-future and the root is-ready', () => {
    scrollToStep(-1)
    Scrolly.init(root)
    expect(steps.every(s => s.classList.contains('is-future'))).toBe(true)
    expect(root.classList.contains('is-ready')).toBe(true)
    expect(root.hasAttribute('data-active-step')).toBe(false)
  })

  test('is idempotent per element', () => {
    scrollToStep(-1)
    const a = Scrolly.init(root)
    const b = Scrolly.init(root)
    expect(a).toBe(b)
  })

  test('init() with no target returns a Story per .scrolly', () => {
    scrollToStep(-1)
    const stories = Scrolly.init()
    expect(stories).toHaveLength(1)
    expect(stories[0]).toBe(Scrolly.init(root))
  })

  test('throws on a selector that matches nothing', () => {
    expect(() => Scrolly.init('#nope')).toThrow(/no element matches/)
  })

  test('data-offset on the element beats opts.offset beats the 0.5 default', () => {
    scrollToStep(-1)
    expect(Scrolly.init(root, { offset: 0.3 }).offset).toBe(0.3)

    buildStory()
    root.dataset.offset = '0.25'
    scrollToStep(-1)
    expect(Scrolly.init(root, { offset: 0.3 }).offset).toBe(0.25)
  })
})

/* ---- state machine ------------------------------------------------------- */

describe('state machine (§5)', () => {
  test('activating the middle step: past/active/future + data-active-step + data-show', () => {
    scrollToStep(1)
    Scrolly.init(root)
    expect(steps[0]?.className).toBe('step is-past')
    expect(steps[1]?.className).toBe('step is-active')
    expect(steps[2]?.className).toBe('step is-future')
    expect(root.getAttribute('data-active-step')).toBe('b')
    expect(graphicA.classList.contains('is-shown')).toBe(false)
    expect(graphicBC.classList.contains('is-shown')).toBe(true) // "b c" lists b
  })

  test('a step without an id is addressed by its index', () => {
    scrollToStep(2)
    Scrolly.init(root)
    expect(root.getAttribute('data-active-step')).toBe('2')
    // data-show matches ids, and this step's generated id is "2" — not "c"
    expect(graphicBC.classList.contains('is-shown')).toBe(false)
  })

  test('progress custom properties are written on init', () => {
    scrollToStep(0)
    Scrolly.init(root)
    expect(root.style.getPropertyValue('--step-progress')).toBe('0.0000')
    expect(root.style.getPropertyValue('--story-progress')).toBe('0.0000')
  })
})

/* ---- events -------------------------------------------------------------- */

describe('events (§7.1)', () => {
  test('stepexit fires before stepenter, with direction', async () => {
    scrollToStep(0)
    const story = Scrolly.init(root)
    const order: string[] = []
    story.on('stepenter', d => order.push(`enter:${d.id}:${d.direction}`))
    story.on('stepexit', d => order.push(`exit:${d.id}:${d.direction}`))

    IOStub.instances[0]?.fire(true) // engage the scroll loop
    scrollToStep(1)
    window.dispatchEvent(new Event('scroll'))
    await new Promise(r => requestAnimationFrame(() => r(null)))

    expect(order).toEqual(['exit:a:down', 'enter:b:down'])
  })

  test('events bubble as plain CustomEvents', () => {
    scrollToStep(-1)
    const seen: StepEventDetail[] = []
    document.addEventListener('scrolly:stepenter', e =>
      seen.push((e as CustomEvent<StepEventDetail>).detail)
    )
    scrollToStep(0)
    Scrolly.init(root)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.id).toBe('a')
  })

  test('on() returns a working unsubscribe', async () => {
    scrollToStep(0)
    const story = Scrolly.init(root)
    const fn = vi.fn()
    const off = story.on('stepenter', fn)
    off()

    IOStub.instances[0]?.fire(true)
    scrollToStep(1)
    window.dispatchEvent(new Event('scroll'))
    await new Promise(r => requestAnimationFrame(() => r(null)))

    expect(fn).not.toHaveBeenCalled()
  })
})

/* ---- §15.2 --progress-<id> ------------------------------------------------ */

describe('--progress-<id> (§15.2)', () => {
  const buildProgressStory = () => {
    document.body.innerHTML = `
      <article class="scrolly">
        <figure></figure>
        <section class="step" id="intro"></section>
        <section class="step" id="not valid"></section>
        <section class="step"></section>
      </article>`
    root = document.querySelector('.scrolly') as HTMLElement
    steps = [...document.querySelectorAll<HTMLElement>('.step')]
  }

  beforeEach(buildProgressStory)

  test('a valid id gets a variable; an invalid ident and an id-less step get none', () => {
    scrollToStep(0) // intro's top exactly on the trigger
    Scrolly.init(root)
    expect(root.style.getPropertyValue('--progress-intro')).toBe('0.0000')
    expect(root.style.getPropertyValue('--progress-not valid')).toBe('')
    expect(root.style.cssText).not.toContain('--progress-2')
  })

  test('tracks --step-progress while its chapter is active', async () => {
    scrollToStep(0)
    Scrolly.init(root)
    IOStub.instances[0]?.fire(true)

    setRect(steps[0] as HTMLElement, 300, 1200) // nudge into the chapter
    window.dispatchEvent(new Event('scroll'))
    await new Promise(r => requestAnimationFrame(() => r(null)))

    const progress = root.style.getPropertyValue('--progress-intro')
    expect(progress).toBe(root.style.getPropertyValue('--step-progress'))
    expect(progress).not.toBe('0.0000')
  })

  test('holds 1 once its chapter has fully passed', async () => {
    scrollToStep(0)
    Scrolly.init(root)
    IOStub.instances[0]?.fire(true)

    scrollToStep(1) // the second step is active now; intro is behind it
    window.dispatchEvent(new Event('scroll'))
    await new Promise(r => requestAnimationFrame(() => r(null)))

    expect(root.style.getPropertyValue('--progress-intro')).toBe('1.0000')
  })

  test('destroy removes every --progress-* variable', () => {
    scrollToStep(0)
    const story = Scrolly.init(root)
    story.destroy()
    expect(root.style.getPropertyValue('--progress-intro')).toBe('')
  })
})

/* ---- §15.2 data-scrub ------------------------------------------------------ */

describe('data-scrub (§15.2)', () => {
  const buildScrubStory = () => {
    document.body.innerHTML = `
      <article class="scrolly">
        <figure>
          <div id="whole" data-scrub></div>
          <div id="chapter" data-scrub="intro"></div>
          <div id="dangling" data-scrub="nope"></div>
        </figure>
        <section class="step" id="intro"></section>
        <section class="step"></section>
      </article>`
    root = document.querySelector('.scrolly') as HTMLElement
    steps = [...document.querySelectorAll<HTMLElement>('.step')]
  }

  beforeEach(buildScrubStory)

  test('a valueless data-scrub stamps --t from --story-progress', () => {
    scrollToStep(0)
    Scrolly.init(root)
    const el = document.getElementById('whole') as HTMLElement
    expect(el.style.getPropertyValue('--t')).toBe('var(--story-progress)')
  })

  test('an id-bound data-scrub stamps --t from the matching --progress-<id>', () => {
    scrollToStep(0)
    Scrolly.init(root)
    const el = document.getElementById('chapter') as HTMLElement
    expect(el.style.getPropertyValue('--t')).toBe('var(--progress-intro)')
  })

  test('a dangling id gets no stamp and warns once, prefixed "scrolly:"', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    scrollToStep(0)
    Scrolly.init(root)
    const el = document.getElementById('dangling') as HTMLElement
    expect(el.style.getPropertyValue('--t')).toBe('')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/^scrolly:/)
    warn.mockRestore()
  })

  test('destroy removes every --t stamp', () => {
    scrollToStep(0)
    const story = Scrolly.init(root)
    story.destroy()
    expect((document.getElementById('whole') as HTMLElement).style.getPropertyValue('--t')).toBe('')
    expect((document.getElementById('chapter') as HTMLElement).style.getPropertyValue('--t')).toBe(
      ''
    )
  })
})

/* ---- teardown ------------------------------------------------------------ */

describe('destroy (§7.2/§7.3)', () => {
  test('reverses every DOM mutation', () => {
    scrollToStep(1)
    const story = Scrolly.init(root)
    story.destroy()

    expect(root.classList.contains('is-ready')).toBe(false)
    expect(root.hasAttribute('data-active-step')).toBe(false)
    expect(root.style.getPropertyValue('--step-progress')).toBe('')
    expect(root.style.getPropertyValue('--story-progress')).toBe('')
    for (const s of steps) expect(s.className).toBe('step')
    expect(graphicBC.classList.contains('is-shown')).toBe(false)
  })

  test('re-init after destroy creates a fresh Story', () => {
    scrollToStep(0)
    const a = Scrolly.init(root)
    a.destroy()
    const b = Scrolly.init(root)
    expect(b).not.toBe(a)
    expect(root.classList.contains('is-ready')).toBe(true)
  })
})
