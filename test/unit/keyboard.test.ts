// @vitest-environment happy-dom
/*
 * §7.4 keyboard stepping, guard matrix first: stepping is an enhancement,
 * never scroll-jacking, so the interesting behavior is everything that must
 * make the handler do nothing. Real smooth-scroll motion is e2e's job.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { handleKeydown, type KeyboardHost } from '../../src/keyboard'

const scrollTo = vi.fn()
let host: KeyboardHost

const key = (init: KeyboardEventInit & { target?: HTMLElement } = {}) => {
  const { target, ...rest } = init
  const e = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true, ...rest })
  if (target) Object.defineProperty(e, 'target', { value: target })
  return e
}

const stepAt = (top: number) => {
  const el = document.createElement('section')
  el.getBoundingClientRect = () => ({ top, bottom: top + 900 }) as DOMRect
  return el
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', scrollTo)
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }))
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })
  Object.defineProperty(window, 'scrollY', { value: 2000, configurable: true })
  // three chapters; the middle one is active
  host = { active: 1, steps: [stepAt(-1000), stepAt(0), stepAt(1000)], offset: 0.5 }
  scrollTo.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('guards — the handler must do nothing when', () => {
  test('the key is not an arrow', () => {
    handleKeydown(key({ key: 'PageDown' }), host)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  test.each(['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const)('%s is held', mod => {
    handleKeydown(key({ [mod]: true }), host)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  test.each(['input', 'textarea', 'select'])('focus is in a %s', tag => {
    handleKeydown(key({ target: document.createElement(tag) }), host)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  test('focus is in a contenteditable element', () => {
    const div = document.createElement('div')
    Object.defineProperty(div, 'isContentEditable', { value: true })
    handleKeydown(key({ target: div }), host)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  test('ArrowRight on the last chapter (no wraparound)', () => {
    host.active = 2
    handleKeydown(key(), host)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  test('ArrowLeft before the first chapter', () => {
    host.active = 0
    handleKeydown(key({ key: 'ArrowLeft' }), host)
    expect(scrollTo).not.toHaveBeenCalled()
  })
})

describe('stepping', () => {
  test('ArrowRight scrolls the next chapter onto the trigger line', () => {
    const e = key()
    handleKeydown(e, host)
    // next top 1000 + scrollY 2000 - trigger 400 + 2
    expect(scrollTo).toHaveBeenCalledWith({ top: 2602, behavior: 'smooth' })
    expect(e.defaultPrevented).toBe(true)
  })

  test('ArrowLeft scrolls back a chapter', () => {
    handleKeydown(key({ key: 'ArrowLeft' }), host)
    expect(scrollTo).toHaveBeenCalledWith({ top: 602, behavior: 'smooth' })
  })

  test('prefers-reduced-motion drops the smooth behavior', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    handleKeydown(key(), host)
    expect(scrollTo).toHaveBeenCalledWith({ top: 2602, behavior: 'auto' })
  })

  test('the trigger line respects the host offset', () => {
    host.offset = 0.25 // trigger 200
    handleKeydown(key(), host)
    expect(scrollTo).toHaveBeenCalledWith({ top: 2802, behavior: 'smooth' })
  })
})
