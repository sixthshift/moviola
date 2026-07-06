/**
 * The Story runtime — one instance per `.scrolly` element. Owns the
 * IntersectionObserver-gated scroll loop and every DOM state write; the math
 * it acts on lives in geometry.ts, the plumbing in events.ts/keyboard.ts.
 */

import { emit, subscribe } from './events'
import { activeIndex, stepProgress, storyProgress } from './geometry'
import { handleKeydown } from './keyboard'
import type { ScrollyEventMap, ScrollyEventName, ScrollyOptions, StepDetail } from './types'

const OFFSET = 0.5
const stepId = (el: HTMLElement, i: number): string => el.id || String(i)

const instances = new WeakMap<HTMLElement, Story>()

/** `Scrolly.init()` is idempotent per element: re-init returns the existing Story. */
export function getOrCreateStory(el: HTMLElement, opts?: ScrollyOptions): Story {
  return instances.get(el) ?? new Story(el, opts)
}

export class Story {
  root: HTMLElement
  offset: number
  graphic: HTMLElement | null
  steps: HTMLElement[]
  shown: HTMLElement[]
  active = -1

  private _engaged = false
  private _ticking = false
  private _subs: Array<() => void> = []
  private _io: IntersectionObserver
  private _onScroll: () => void
  private _onKey: (e: KeyboardEvent) => void

  constructor(root: HTMLElement, opts: ScrollyOptions = {}) {
    this.root = root
    this.offset = parseFloat(root.dataset.offset ?? String(opts.offset ?? OFFSET))
    this.graphic = root.querySelector(':scope > figure')
    this.steps = [...root.querySelectorAll<HTMLElement>(':scope > .step')]
    this.shown = this.graphic ? [...this.graphic.querySelectorAll<HTMLElement>('[data-show]')] : []
    this._onScroll = () => this._tick()
    this._onKey = e => handleKeydown(e, this)
    instances.set(root, this)

    // Observe the story itself; the scroll loop only runs while it's on screen.
    this._io = new IntersectionObserver(
      entries => {
        this._engage(entries.some(e => e.isIntersecting))
      },
      { rootMargin: '100px 0px' }
    )
    this._io.observe(root)

    for (const s of this.steps) s.classList.add('is-future')
    // stamped last: hiding CSS is scoped under it, so a JS failure
    // leaves the page fully readable
    root.classList.add('is-ready')
    this._update()
  }

  private _engage(on: boolean): void {
    if (on === this._engaged) return
    this._engaged = on
    const fn = on ? 'addEventListener' : 'removeEventListener'
    window[fn]('scroll', this._onScroll, { passive: true } as AddEventListenerOptions)
    window[fn]('resize', this._onScroll)
    window[fn]('keydown', this._onKey as EventListener)
    if (on) this._update()
  }

  private _tick(): void {
    if (this._ticking) return
    this._ticking = true
    requestAnimationFrame(() => {
      this._ticking = false
      this._update()
    })
  }

  private _update(): void {
    const first = this.steps[0]
    const last = this.steps[this.steps.length - 1]
    if (!first || !last) return
    const trigger = window.innerHeight * this.offset

    const tops = this.steps.map(s => s.getBoundingClientRect().top)
    const active = activeIndex(tops, trigger)
    if (active !== this.active) this._activate(active)

    const story = storyProgress(
      first.getBoundingClientRect().top,
      last.getBoundingClientRect().bottom,
      trigger
    )

    let step = 0
    const current = this.steps[active]
    if (current) {
      const r = current.getBoundingClientRect()
      const next = this.steps[active + 1]
      const end = next ? next.getBoundingClientRect().top : r.bottom
      step = stepProgress(r.top, end, trigger)
    }

    this.root.style.setProperty('--story-progress', story.toFixed(4))
    this.root.style.setProperty('--step-progress', step.toFixed(4))
    if (active >= 0) {
      emit(this.root, 'progress', { ...this._detail(active), progress: step, storyProgress: story })
    }
  }

  private _activate(next: number): void {
    const prev = this.active
    const direction = next > prev ? 'down' : 'up'
    this.active = next

    this.steps.forEach((s, i) => {
      s.classList.toggle('is-past', next > -1 && i < next)
      s.classList.toggle('is-active', i === next)
      s.classList.toggle('is-future', next < 0 || i > next)
    })

    const activeStep = this.steps[next]
    const id = activeStep ? stepId(activeStep, next) : null
    if (id === null) this.root.removeAttribute('data-active-step')
    else this.root.setAttribute('data-active-step', id)

    for (const el of this.shown) {
      const ids = (el.dataset.show ?? '').split(/\s+/)
      el.classList.toggle('is-shown', id !== null && ids.includes(id))
    }

    // Exit fires before enter (§7.1).
    if (prev >= 0) emit(this.root, 'stepexit', { ...this._detail(prev), direction })
    if (next >= 0) emit(this.root, 'stepenter', { ...this._detail(next), direction })
  }

  private _detail(i: number): StepDetail {
    const step = this.steps[i] as HTMLElement
    return { step, id: stepId(step, i), index: i }
  }

  on<K extends ScrollyEventName>(name: K, fn: (detail: ScrollyEventMap[K]) => void): () => void {
    const unsubscribe = subscribe(this.root, name, fn)
    const off = () => {
      unsubscribe()
      const i = this._subs.indexOf(off)
      if (i !== -1) this._subs.splice(i, 1)
    }
    this._subs.push(off)
    return off
  }

  destroy(): void {
    this._io.disconnect()
    this._engage(false)
    for (const off of [...this._subs]) off()
    this._subs = []
    for (const s of this.steps) s.classList.remove('is-past', 'is-active', 'is-future')
    for (const el of this.shown) el.classList.remove('is-shown')
    this.root.classList.remove('is-ready')
    this.root.removeAttribute('data-active-step')
    this.root.style.removeProperty('--step-progress')
    this.root.style.removeProperty('--story-progress')
    instances.delete(this.root)
  }
}
