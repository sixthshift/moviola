// @vitest-environment happy-dom
/*
 * The Story state machine driven headlessly: IntersectionObserver and
 * getBoundingClientRect are stubbed so §5/§7 transitions can be asserted
 * without a browser. Real scrolling (sticky frames, rAF timing, no-JS
 * degradation) is the e2e suite's job — this file owns the pure DOM-state
 * contract.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import Moviola from '../../src/index'
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

/**
 * §15.4 test double for `document.startViewTransition`. Unlike a microtask
 * shim, the update callback is captured but never auto-invoked — the test
 * decides when (or whether) the "browser" gets around to running it. That
 * makes "events fire before the write lands" and "a stale write never
 * resurrects state" assertable without racing real scheduler timing.
 */
class FakeTransition {
  skipTransition = vi.fn()
}

const stubViewTransition = () => {
  const pending: Array<() => void> = []
  const transitions: FakeTransition[] = []
  const fn = vi.fn((cb: () => void) => {
    pending.push(cb)
    const t = new FakeTransition()
    transitions.push(t)
    return t as unknown as ViewTransition
  })
  document.startViewTransition = fn as unknown as Document['startViewTransition']
  return { pending, transitions, calls: fn }
}

const unstubViewTransition = () => {
  delete (document as { startViewTransition?: unknown }).startViewTransition
}

/* ---- fixture ------------------------------------------------------------- */
// Viewport 800 high, offset 0.5 → trigger line at 400.

let root: HTMLElement
let steps: HTMLElement[]
let graphicA: HTMLElement
let graphicBC: HTMLElement

const buildStory = () => {
  document.body.innerHTML = `
    <article class="moviola">
      <figure>
        <div id="ga" data-show="a"></div>
        <div id="gbc" data-show="b c"></div>
      </figure>
      <section class="step" id="a"></section>
      <section class="step" id="b"></section>
      <section class="step"></section>
    </article>`
  root = document.querySelector('.moviola') as HTMLElement
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
    Moviola.init(root)
    expect(steps.every(s => s.classList.contains('is-future'))).toBe(true)
    expect(root.classList.contains('is-ready')).toBe(true)
    expect(root.hasAttribute('data-active-step')).toBe(false)
  })

  test('is idempotent per element', () => {
    scrollToStep(-1)
    const a = Moviola.init(root)
    const b = Moviola.init(root)
    expect(a).toBe(b)
  })

  test('init() with no target returns a Story per .moviola', () => {
    scrollToStep(-1)
    const stories = Moviola.init()
    expect(stories).toHaveLength(1)
    expect(stories[0]).toBe(Moviola.init(root))
  })

  test('throws on a selector that matches nothing', () => {
    expect(() => Moviola.init('#nope')).toThrow(/no element matches/)
  })

  test('data-offset on the element beats opts.offset beats the 0.5 default', () => {
    scrollToStep(-1)
    expect(Moviola.init(root, { offset: 0.3 }).offset).toBe(0.3)

    buildStory()
    root.dataset.offset = '0.25'
    scrollToStep(-1)
    expect(Moviola.init(root, { offset: 0.3 }).offset).toBe(0.25)
  })
})

/* ---- state machine ------------------------------------------------------- */

describe('state machine (§5)', () => {
  test('activating the middle step: past/active/future + data-active-step + data-show', () => {
    scrollToStep(1)
    Moviola.init(root)
    expect(steps[0]?.className).toBe('step is-past')
    expect(steps[1]?.className).toBe('step is-active')
    expect(steps[2]?.className).toBe('step is-future')
    expect(root.getAttribute('data-active-step')).toBe('b')
    expect(graphicA.classList.contains('is-shown')).toBe(false)
    expect(graphicBC.classList.contains('is-shown')).toBe(true) // "b c" lists b
  })

  test('a step without an id is addressed by its index', () => {
    scrollToStep(2)
    Moviola.init(root)
    expect(root.getAttribute('data-active-step')).toBe('2')
    // data-show matches ids, and this step's generated id is "2" — not "c"
    expect(graphicBC.classList.contains('is-shown')).toBe(false)
  })

  test('progress custom properties are written on init', () => {
    scrollToStep(0)
    Moviola.init(root)
    expect(root.style.getPropertyValue('--step-progress')).toBe('0.0000')
    expect(root.style.getPropertyValue('--story-progress')).toBe('0.0000')
  })
})

/* ---- events -------------------------------------------------------------- */

describe('events (§7.1)', () => {
  test('stepexit fires before stepenter, with direction', async () => {
    scrollToStep(0)
    const story = Moviola.init(root)
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
    document.addEventListener('moviola:stepenter', e =>
      seen.push((e as CustomEvent<StepEventDetail>).detail)
    )
    scrollToStep(0)
    Moviola.init(root)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.id).toBe('a')
  })

  test('on() returns a working unsubscribe', async () => {
    scrollToStep(0)
    const story = Moviola.init(root)
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
      <article class="moviola">
        <figure></figure>
        <section class="step" id="intro"></section>
        <section class="step" id="not valid"></section>
        <section class="step"></section>
      </article>`
    root = document.querySelector('.moviola') as HTMLElement
    steps = [...document.querySelectorAll<HTMLElement>('.step')]
  }

  beforeEach(buildProgressStory)

  test('a valid id gets a variable; an invalid ident and an id-less step get none', () => {
    scrollToStep(0) // intro's top exactly on the trigger
    Moviola.init(root)
    expect(root.style.getPropertyValue('--progress-intro')).toBe('0.0000')
    expect(root.style.getPropertyValue('--progress-not valid')).toBe('')
    expect(root.style.cssText).not.toContain('--progress-2')
  })

  test('tracks --step-progress while its chapter is active', async () => {
    scrollToStep(0)
    Moviola.init(root)
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
    Moviola.init(root)
    IOStub.instances[0]?.fire(true)

    scrollToStep(1) // the second step is active now; intro is behind it
    window.dispatchEvent(new Event('scroll'))
    await new Promise(r => requestAnimationFrame(() => r(null)))

    expect(root.style.getPropertyValue('--progress-intro')).toBe('1.0000')
  })

  test('destroy removes every --progress-* variable', () => {
    scrollToStep(0)
    const story = Moviola.init(root)
    story.destroy()
    expect(root.style.getPropertyValue('--progress-intro')).toBe('')
  })
})

/* ---- §15.2 data-scrub ------------------------------------------------------ */

describe('data-scrub (§15.2)', () => {
  // The dangling scrub lives in its own test only (appended there, not
  // here): warnOnce's dedup Set is module-level (§15.6), so sharing one
  // dangling id across every test in this describe would have only the
  // FIRST test's init actually print it — the rest would be silently
  // (and correctly) deduped, which would break their unrelated assertions.
  const buildScrubStory = () => {
    document.body.innerHTML = `
      <article class="moviola">
        <figure>
          <div id="whole" data-scrub></div>
          <div id="chapter" data-scrub="intro"></div>
        </figure>
        <section class="step" id="intro"></section>
        <section class="step"></section>
      </article>`
    root = document.querySelector('.moviola') as HTMLElement
    steps = [...document.querySelectorAll<HTMLElement>('.step')]
  }

  beforeEach(buildScrubStory)

  test('a valueless data-scrub stamps --t from --story-progress', () => {
    scrollToStep(0)
    Moviola.init(root)
    const el = document.getElementById('whole') as HTMLElement
    expect(el.style.getPropertyValue('--t')).toBe('var(--story-progress)')
  })

  test('an id-bound data-scrub stamps --t from the matching --progress-<id>', () => {
    scrollToStep(0)
    Moviola.init(root)
    const el = document.getElementById('chapter') as HTMLElement
    expect(el.style.getPropertyValue('--t')).toBe('var(--progress-intro)')
  })

  test('a dangling id gets no stamp and warns once, prefixed "moviola:"', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dangling = document.createElement('div')
    dangling.id = 'dangling'
    dangling.dataset.scrub = 'nope'
    ;(root.querySelector('figure') as HTMLElement).appendChild(dangling)

    scrollToStep(0)
    Moviola.init(root)
    expect(dangling.style.getPropertyValue('--t')).toBe('')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toMatch(/^moviola:/)
    warn.mockRestore()
  })

  test('destroy removes every --t stamp', () => {
    scrollToStep(0)
    const story = Moviola.init(root)
    story.destroy()
    expect((document.getElementById('whole') as HTMLElement).style.getPropertyValue('--t')).toBe('')
    expect((document.getElementById('chapter') as HTMLElement).style.getPropertyValue('--t')).toBe(
      ''
    )
  })
})

/* ---- §15.4 data-morph ------------------------------------------------------ */

describe('data-morph (§15.4)', () => {
  afterEach(unstubViewTransition)

  test('stepexit/stepenter fire synchronously; the morph write lands independently, later', async () => {
    scrollToStep(0)
    root.dataset.morph = ''
    const story = Moviola.init(root)
    const { pending } = stubViewTransition()

    const order: string[] = []
    story.on('stepenter', d => order.push(`enter:${d.id}`))
    story.on('stepexit', d => order.push(`exit:${d.id}`))

    IOStub.instances[0]?.fire(true)
    scrollToStep(1)
    window.dispatchEvent(new Event('scroll'))
    await new Promise(r => requestAnimationFrame(() => r(null)))

    // Events already fired even though the transition's write is still
    // sitting unflushed — they never waited on it.
    expect(order).toEqual(['exit:a', 'enter:b'])
    expect(root.getAttribute('data-active-step')).toBe('a')
    expect(pending).toHaveLength(1)

    pending[0]?.() // the "browser" finally runs the deferred write
    expect(root.getAttribute('data-active-step')).toBe('b')
    expect(order).toEqual(['exit:a', 'enter:b']) // unchanged — write never re-fires events
  })

  test('a step-change mid-morph skips the running transition; latest wins, no queue', async () => {
    scrollToStep(0)
    root.dataset.morph = ''
    Moviola.init(root)
    const { pending, transitions } = stubViewTransition()
    IOStub.instances[0]?.fire(true)

    scrollToStep(1)
    window.dispatchEvent(new Event('scroll'))
    await new Promise(r => requestAnimationFrame(() => r(null)))
    expect(transitions).toHaveLength(1)
    const first = transitions[0]

    scrollToStep(2)
    window.dispatchEvent(new Event('scroll'))
    await new Promise(r => requestAnimationFrame(() => r(null)))

    expect(first?.skipTransition).toHaveBeenCalledTimes(1)
    expect(transitions).toHaveLength(2) // a fresh transition, not a reused/queued one
    expect(transitions[1]?.skipTransition).not.toHaveBeenCalled()
    for (const fn of pending) fn()
    expect(root.getAttribute('data-active-step')).toBe('2') // third step has no id (§4)
  })

  test('progress variables keep updating every frame while a morph write is still pending', async () => {
    scrollToStep(0)
    root.dataset.morph = ''
    Moviola.init(root)
    stubViewTransition()
    IOStub.instances[0]?.fire(true)

    scrollToStep(1) // triggers _activate -> queues a write that is never flushed below
    window.dispatchEvent(new Event('scroll'))
    await new Promise(r => requestAnimationFrame(() => r(null)))
    expect(root.getAttribute('data-active-step')).toBe('a') // write still pending

    setRect(steps[1] as HTMLElement, 350, 1250) // nudge further into the same chapter
    window.dispatchEvent(new Event('scroll'))
    await new Promise(r => requestAnimationFrame(() => r(null)))

    // §5.2/§15.2 progress vars are never routed through the transition: they
    // moved even though the class/attribute batch is still unapplied.
    expect(root.style.getPropertyValue('--step-progress')).not.toBe('0.0000')
    expect(root.getAttribute('data-active-step')).toBe('a')
  })

  test('no View Transitions API: data-morph is inert, the batch lands exactly as before', async () => {
    scrollToStep(0)
    root.dataset.morph = ''
    Moviola.init(root) // no stub installed — happy-dom has no startViewTransition
    IOStub.instances[0]?.fire(true)

    scrollToStep(1)
    window.dispatchEvent(new Event('scroll'))
    await new Promise(r => requestAnimationFrame(() => r(null)))

    expect(root.getAttribute('data-active-step')).toBe('b') // synchronous, zero delta
  })

  test('prefers-reduced-motion: data-morph is inert even when the API exists', async () => {
    const { calls } = stubViewTransition()
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    scrollToStep(0)
    root.dataset.morph = ''
    Moviola.init(root)
    IOStub.instances[0]?.fire(true)

    scrollToStep(1)
    window.dispatchEvent(new Event('scroll'))
    await new Promise(r => requestAnimationFrame(() => r(null)))

    expect(calls).not.toHaveBeenCalled()
    expect(root.getAttribute('data-active-step')).toBe('b') // synchronous, zero delta
  })

  test('RED-TEAM: destroy() during an in-flight morph leaves a clean DOM', async () => {
    scrollToStep(0)
    root.dataset.morph = ''
    const story = Moviola.init(root)
    const { pending, transitions } = stubViewTransition()
    IOStub.instances[0]?.fire(true)

    scrollToStep(1) // queues a write that will never get to run before destroy
    window.dispatchEvent(new Event('scroll'))
    await new Promise(r => requestAnimationFrame(() => r(null)))
    expect(pending).toHaveLength(1)

    story.destroy()

    expect(transitions[0]?.skipTransition).toHaveBeenCalledTimes(1)
    expect(root.classList.contains('is-ready')).toBe(false)
    for (const s of steps) expect(s.className).toBe('step')
    expect(root.hasAttribute('data-active-step')).toBe(false)

    // Simulate the browser eventually running the stale queued write anyway
    // (skipTransition only skips the animation, not the callback) — it must
    // not resurrect any state onto the torn-down story.
    pending[0]?.()
    expect(root.classList.contains('is-ready')).toBe(false)
    for (const s of steps) expect(s.className).toBe('step')
    expect(root.hasAttribute('data-active-step')).toBe(false)
  })
})

/* ---- §15.6 diagnostics ----------------------------------------------------
 *
 * `warnOnce`'s dedup Set is module-level (shared by story.ts and camera.ts,
 * per M205), so it persists across every test in THIS file, not just within
 * one test. Each case below therefore uses a distinct dangling token/id/
 * selector never reused elsewhere in this file, so a prior test's warning
 * can't silently suppress this one's — except the "shared dedup" test below,
 * which relies on exactly that persistence, and the resize-idempotency test,
 * which asserts it within a single test (init + two resizes, one warning).
 */

describe('diagnostics (§15.6)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('data-show dangling token', () => {
    const buildShowStory = (tokens: string) => {
      document.body.innerHTML = `
        <article class="moviola">
          <figure><div id="g" data-show="${tokens}"></div></figure>
          <section class="step" id="a"></section>
          <section class="step" id="b"></section>
        </article>`
      root = document.querySelector('.moviola') as HTMLElement
      steps = [...document.querySelectorAll<HTMLElement>('.step')]
    }

    test('a token matching no step id warns once, prefixed "moviola:"', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      buildShowStory('a m205-nope')
      scrollToStep(0)
      Moviola.init(root)

      const matches = warn.mock.calls.filter(c => String(c[0]).includes('m205-nope'))
      expect(matches).toHaveLength(1)
      expect(matches[0]?.[0]).toMatch(/^moviola:/)
      expect(matches[0]?.[0]).toContain('data-show="m205-nope"')
    })

    // A step addressed only by its index fallback (stepId's `el.id ||
    // String(i)`) must never be mistaken for a dangling reference — the
    // check has to resolve tokens the same way the runtime does.
    test('a token matching an index-fallback id (no real id on that step) does not warn', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      document.body.innerHTML = `
        <article class="moviola">
          <figure><div id="g" data-show="1"></div></figure>
          <section class="step" id="a"></section>
          <section class="step"></section>
        </article>`
      root = document.querySelector('.moviola') as HTMLElement
      steps = [...document.querySelectorAll<HTMLElement>('.step')]
      scrollToStep(1)
      Moviola.init(root)

      expect(warn).not.toHaveBeenCalled()
      expect((document.getElementById('g') as HTMLElement).classList.contains('is-shown')).toBe(
        true
      )
    })

    test('fail-soft: DOM state is identical with and without the dangling token', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      buildShowStory('a')
      scrollToStep(0)
      Moviola.init(root)
      const clean = {
        activeStep: root.getAttribute('data-active-step'),
        classes: steps.map(s => s.className),
        shown: (document.getElementById('g') as HTMLElement).classList.contains('is-shown'),
        stepProgress: root.style.getPropertyValue('--step-progress'),
        storyProgress: root.style.getPropertyValue('--story-progress'),
      }

      buildShowStory('a m205-dangling-fail-soft')
      scrollToStep(0)
      Moviola.init(root)
      const withDangling = {
        activeStep: root.getAttribute('data-active-step'),
        classes: steps.map(s => s.className),
        shown: (document.getElementById('g') as HTMLElement).classList.contains('is-shown'),
        stepProgress: root.style.getPropertyValue('--step-progress'),
        storyProgress: root.style.getPropertyValue('--story-progress'),
      }

      expect(withDangling).toEqual(clean)
    })
  })

  describe('data-scrub dangling id: fail-soft and shared dedup', () => {
    test('fail-soft: DOM state (incl. the other, valid --t stamps) is identical with and without the dangling element', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      const snapshot = () => ({
        activeStep: root.getAttribute('data-active-step'),
        stepProgress: root.style.getPropertyValue('--step-progress'),
        whole: (document.getElementById('whole') as HTMLElement).style.getPropertyValue('--t'),
        chapter: (document.getElementById('chapter') as HTMLElement).style.getPropertyValue('--t'),
      })

      document.body.innerHTML = `
        <article class="moviola">
          <figure>
            <div id="whole" data-scrub></div>
            <div id="chapter" data-scrub="intro"></div>
          </figure>
          <section class="step" id="intro"></section>
          <section class="step"></section>
        </article>`
      root = document.querySelector('.moviola') as HTMLElement
      steps = [...document.querySelectorAll<HTMLElement>('.step')]
      scrollToStep(0)
      Moviola.init(root)
      const withoutDangling = snapshot()

      document.body.innerHTML = `
        <article class="moviola">
          <figure>
            <div id="whole" data-scrub></div>
            <div id="chapter" data-scrub="intro"></div>
            <div id="dangling" data-scrub="m205-fail-soft-nope"></div>
          </figure>
          <section class="step" id="intro"></section>
          <section class="step"></section>
        </article>`
      root = document.querySelector('.moviola') as HTMLElement
      steps = [...document.querySelectorAll<HTMLElement>('.step')]
      scrollToStep(0)
      Moviola.init(root)
      const withDangling = snapshot()

      expect(withDangling).toEqual(withoutDangling)
    })

    test('the warn-once dedup is shared across separate Story instances (module-level)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      document.body.innerHTML = `
        <article class="moviola" id="s1">
          <figure><div data-scrub="m205-shared-nope"></div></figure>
          <section class="step" id="a"></section>
        </article>
        <article class="moviola" id="s2">
          <figure><div data-scrub="m205-shared-nope"></div></figure>
          <section class="step" id="a"></section>
        </article>`
      const r1 = document.getElementById('s1') as HTMLElement
      const r2 = document.getElementById('s2') as HTMLElement

      Moviola.init(r1)
      Moviola.init(r2)

      const matches = warn.mock.calls.filter(c => String(c[0]).includes('m205-shared-nope'))
      expect(matches).toHaveLength(1) // one instance's warn suppresses the other's identical message
    })
  })

  describe('data-camera with zero data-focus anywhere (§15.6 d)', () => {
    const buildCameraStory = (rootFocus?: string, stepFocus?: string) => {
      document.body.innerHTML = `
        <article class="moviola"${rootFocus ? ` data-focus="${rootFocus}"` : ''}>
          <figure><svg><g data-camera></g></svg></figure>
          <section class="step" id="one"${stepFocus ? ` data-focus="${stepFocus}"` : ''}></section>
          <section class="step" id="two"></section>
        </article>`
      root = document.querySelector('.moviola') as HTMLElement
      steps = [...document.querySelectorAll<HTMLElement>('.step')]
    }

    test('warns once, prefixed "moviola:", and stays deduped across a resize re-measure', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      buildCameraStory()
      scrollToStep(-1)
      Moviola.init(root)
      IOStub.instances[0]?.fire(true) // engage: resize listener only attaches while engaged

      window.dispatchEvent(new Event('resize'))
      window.dispatchEvent(new Event('resize'))

      const matches = warn.mock.calls.filter(c =>
        String(c[0]).includes('data-camera has no data-focus')
      )
      expect(matches).toHaveLength(1)
      expect(matches[0]?.[0]).toMatch(/^moviola:/)
    })

    test('no warning when the root has data-focus', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      buildCameraStory('#one')
      scrollToStep(-1)
      Moviola.init(root)

      expect(
        warn.mock.calls.some(c => String(c[0]).includes('data-camera has no data-focus'))
      ).toBe(false)
    })

    test('no warning when a step has data-focus', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      buildCameraStory(undefined, '#one')
      scrollToStep(-1)
      Moviola.init(root)

      expect(
        warn.mock.calls.some(c => String(c[0]).includes('data-camera has no data-focus'))
      ).toBe(false)
    })
  })
})

/* ---- teardown ------------------------------------------------------------ */

describe('destroy (§7.2/§7.3)', () => {
  test('reverses every DOM mutation', () => {
    scrollToStep(1)
    const story = Moviola.init(root)
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
    const a = Moviola.init(root)
    a.destroy()
    const b = Moviola.init(root)
    expect(b).not.toBe(a)
    expect(root.classList.contains('is-ready')).toBe(true)
  })
})
