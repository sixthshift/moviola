/**
 * The Story runtime — one instance per `.scrolly` element. Owns the
 * IntersectionObserver-gated scroll loop and every §5–§7 DOM state write; the
 * math it acts on lives in geometry.ts, the plumbing in events.ts/keyboard.ts,
 * and the §15 motion writes (scrub stamps, camera, morph) in motion.ts.
 */

import { warnOnce } from './camera'
import { emit, subscribe } from './events'
import { activeIndex, chapterProgress, stepProgress, storyProgress } from './geometry'
import { handleKeydown } from './keyboard'
import { Motion } from './motion'
import type { ScrollyEventMap, ScrollyEventName, ScrollyOptions, StepDetail } from './types'

const OFFSET = 0.5
const stepId = (el: HTMLElement, i: number): string => el.id || String(i)
// §15.2: --progress-<id> is only emitted for steps whose *own* id (not the
// index fallback stepId() uses) is a valid custom-property ident.
const VALID_IDENT = /^[A-Za-z0-9_-]+$/

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
  private _onResize: () => void
  private _onKey: (e: KeyboardEvent) => void
  /** Steps addressable as `--progress-<id>` (§15.2), fixed at construction. */
  private _progressIds: Array<{ id: string; index: number }>
  /** §15's writes — the core hands it the moments, never the state (see motion.ts). */
  private _motion: Motion
  private _destroyed = false

  constructor(root: HTMLElement, opts: ScrollyOptions = {}) {
    this.root = root
    this.offset = parseFloat(root.dataset.offset ?? String(opts.offset ?? OFFSET))
    this.graphic = root.querySelector(':scope > figure')
    this.steps = [...root.querySelectorAll<HTMLElement>(':scope > .step')]
    this.shown = this.graphic ? [...this.graphic.querySelectorAll<HTMLElement>('[data-show]')] : []
    this._progressIds = this.steps
      .map((s, index) => ({ id: s.id, index }))
      .filter(({ id }) => VALID_IDENT.test(id))
    this._onScroll = () => this._tick()
    this._onResize = () => {
      this._motion.measure()
      this._tick()
    }
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
    this._warnDanglingShows()
    this._motion = new Motion(
      root,
      this.graphic,
      this.steps,
      this._progressIds.map(({ id }) => id)
    )
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
    window[fn]('resize', this._onResize)
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

    const lastBottom = last.getBoundingClientRect().bottom
    const story = storyProgress(first.getBoundingClientRect().top, lastBottom, trigger)

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

    if (this._progressIds.length > 0) {
      // ends[i] is the next step's top, or (for the last step) its own
      // bottom — reusing tops and lastBottom already read above, so this
      // adds no getBoundingClientRect calls beyond the existing per-step read.
      const ends = [...tops.slice(1), lastBottom]
      const chapters = chapterProgress(tops, ends, trigger)
      for (const { id, index } of this._progressIds) {
        this.root.style.setProperty(`--progress-${id}`, (chapters[index] ?? 0).toFixed(4))
      }
    }

    this._motion.update(active, step)

    if (active >= 0) {
      emit(this.root, 'progress', { ...this._detail(active), progress: step, storyProgress: story })
    }
  }

  private _activate(next: number): void {
    const prev = this.active
    const direction = next > prev ? 'down' : 'up'
    this.active = next

    // §5.2's atomic write batch — the ONLY thing §15.4 data-morph wraps.
    // Progress variables (--step-progress etc.) live in _update(), never here.
    const write = () => {
      if (this._destroyed) return
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
    }

    // The motion layer re-measures its shots and decides whether the batch
    // runs inside a §15.4 morph; without one it just calls write() straight
    // through (§15 lives in motion.ts).
    this._motion.stepChange(write)

    // Exit fires before enter (§7.1) — synchronous either way: the transition
    // above is fire-and-forget and never delays or reorders these.
    if (prev >= 0) emit(this.root, 'stepexit', { ...this._detail(prev), direction })
    if (next >= 0) emit(this.root, 'stepenter', { ...this._detail(next), direction })
  }

  // §15.6(a): a data-show token is addressed by the SAME id a step is
  // addressed by everywhere else (stepId — real id, or index fallback), so
  // an index-fallback id is never mistaken for a dangling reference.
  private _warnDanglingShows(): void {
    const ids = new Set(this.steps.map((s, i) => stepId(s, i)))
    for (const el of this.shown) {
      for (const token of (el.dataset.show ?? '').split(/\s+/).filter(Boolean)) {
        if (!ids.has(token)) warnOnce(`scrolly: data-show="${token}" matches no step id`)
      }
    }
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
    // §15.4 RED-TEAM: an in-flight morph's write() is still queued by the
    // browser even after motion skips the transition — the flag stops it from
    // resurrecting classes/attributes onto a torn-down story.
    this._destroyed = true
    this._motion.destroy()
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
    for (const { id } of this._progressIds) this.root.style.removeProperty(`--progress-${id}`)
    instances.delete(this.root)
  }
}
