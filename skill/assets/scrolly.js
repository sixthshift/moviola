/*!
 * scrolly — the scrollytelling framework
 *
 * You write the DOM, scrolly runs the state machine, effects live in your CSS.
 *
 * Document model:
 *   <article class="scrolly" data-layout="side-right" data-offset="0.5">
 *     <figure> …graphic; children tagged data-show="step-id …"… </figure>
 *     <section class="step" id="intro">…</section>
 *     <section class="step" id="crash">…</section>
 *   </article>
 *
 * State machine output (all effects belong in CSS):
 *   steps            → .is-past / .is-active / .is-future
 *   [data-show] els  → .is-shown while a listed step is active
 *   root             → [data-active-step="…"], --step-progress, --story-progress
 *
 * Events (bubbling CustomEvents, detail = { step, id, index, direction }):
 *   scrolly:stepenter · scrolly:stepexit · scrolly:progress
 */
(() => {
  'use strict'

  const OFFSET = 0.5
  const clamp = v => Math.min(1, Math.max(0, v))
  const stepId = (el, i) => el.id || String(i)
  const instances = new WeakMap()

  class Story {
    constructor (root, opts = {}) {
      this.root = root
      this.offset = parseFloat(root.dataset.offset ?? opts.offset ?? OFFSET)
      this.graphic = root.querySelector(':scope > figure')
      this.steps = [...root.querySelectorAll(':scope > .step')]
      this.shown = this.graphic ? [...this.graphic.querySelectorAll('[data-show]')] : []
      this.active = -1
      this._engaged = false
      this._ticking = false
      this._subs = []
      this._onScroll = this._onScroll.bind(this)
      this._onKey = this._onKey.bind(this)

      // Observe the story itself; the scroll loop only runs while it's on screen.
      this._io = new IntersectionObserver(entries => {
        this._engage(entries.some(e => e.isIntersecting))
      }, { rootMargin: '100px 0px' })
      this._io.observe(root)

      this.steps.forEach(s => s.classList.add('is-future'))
      // stamped last: hiding CSS is scoped under it, so a JS failure
      // leaves the page fully readable
      root.classList.add('is-ready')
      this._update()
    }

    _engage (on) {
      if (on === this._engaged) return
      this._engaged = on
      const fn = on ? 'addEventListener' : 'removeEventListener'
      window[fn]('scroll', this._onScroll, { passive: true })
      window[fn]('resize', this._onScroll)
      window[fn]('keydown', this._onKey)
      if (on) this._update()
    }

    // ←/→ step between chapters while the story is on screen. Vertical
    // scroll keys stay the browser's — stepping is an enhancement, never
    // scroll-jacking.
    _onKey (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const t = e.target
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const next = this.active + (e.key === 'ArrowRight' ? 1 : -1)
      if (next < 0 || next >= this.steps.length) return
      e.preventDefault()
      const trigger = window.innerHeight * this.offset
      const top = this.steps[next].getBoundingClientRect().top + window.scrollY
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      window.scrollTo({ top: top - trigger + 2, behavior: reduce ? 'auto' : 'smooth' })
    }

    _onScroll () {
      if (this._ticking) return
      this._ticking = true
      requestAnimationFrame(() => {
        this._ticking = false
        this._update()
      })
    }

    _update () {
      if (!this.steps.length) return
      const trigger = window.innerHeight * this.offset

      // Active step = the last one whose top has crossed the trigger line.
      let active = -1
      for (const [i, step] of this.steps.entries()) {
        if (step.getBoundingClientRect().top > trigger) break
        active = i
      }
      if (active !== this.active) this._activate(active)

      const first = this.steps[0].getBoundingClientRect()
      const last = this.steps[this.steps.length - 1].getBoundingClientRect()
      const story = clamp((trigger - first.top) / Math.max(1, last.bottom - first.top))

      // Step progress runs over the chapter: this step's top → the next step's top.
      let step = 0
      if (active >= 0) {
        const r = this.steps[active].getBoundingClientRect()
        const next = this.steps[active + 1]
        const end = next ? next.getBoundingClientRect().top : r.bottom
        step = clamp((trigger - r.top) / Math.max(1, end - r.top))
      }

      this.root.style.setProperty('--story-progress', story.toFixed(4))
      this.root.style.setProperty('--step-progress', step.toFixed(4))
      if (active >= 0) {
        this._emit('progress', { ...this._detail(active), progress: step, storyProgress: story })
      }
    }

    _activate (next) {
      const prev = this.active
      const direction = next > prev ? 'down' : 'up'
      this.active = next

      this.steps.forEach((s, i) => {
        s.classList.toggle('is-past', next > -1 && i < next)
        s.classList.toggle('is-active', i === next)
        s.classList.toggle('is-future', next < 0 || i > next)
      })

      const id = next >= 0 ? stepId(this.steps[next], next) : null
      if (id === null) this.root.removeAttribute('data-active-step')
      else this.root.setAttribute('data-active-step', id)

      for (const el of this.shown) {
        const ids = el.dataset.show.split(/\s+/)
        el.classList.toggle('is-shown', id !== null && ids.includes(id))
      }

      if (prev >= 0) this._emit('stepexit', { ...this._detail(prev), direction })
      if (next >= 0) this._emit('stepenter', { ...this._detail(next), direction })
    }

    _detail (i) {
      return { step: this.steps[i], id: stepId(this.steps[i], i), index: i }
    }

    _emit (name, detail) {
      this.root.dispatchEvent(new CustomEvent(`scrolly:${name}`, { detail, bubbles: true }))
    }

    on (name, fn) {
      const type = `scrolly:${name}`
      const handler = e => fn(e.detail)
      this.root.addEventListener(type, handler)
      this._subs.push([type, handler])
      return () => {
        this.root.removeEventListener(type, handler)
        const i = this._subs.findIndex(s => s[1] === handler)
        if (i !== -1) this._subs.splice(i, 1)
      }
    }

    destroy () {
      this._io.disconnect()
      this._engage(false)
      this._subs.forEach(([type, handler]) => this.root.removeEventListener(type, handler))
      this._subs = []
      this.steps.forEach(s => s.classList.remove('is-past', 'is-active', 'is-future'))
      this.shown.forEach(el => el.classList.remove('is-shown'))
      this.root.classList.remove('is-ready')
      this.root.removeAttribute('data-active-step')
      this.root.style.removeProperty('--step-progress')
      this.root.style.removeProperty('--story-progress')
      instances.delete(this.root)
    }
  }

  const Scrolly = {
    version: '0.0.1',

    /**
     * Scrolly.init()          → Story[] for every .scrolly on the page
     * Scrolly.init(target)    → Story for a selector or element
     * Idempotent per element: re-init returns the existing Story.
     */
    init (target, opts) {
      const get = el => {
        if (!instances.has(el)) instances.set(el, new Story(el, opts))
        return instances.get(el)
      }
      if (target === undefined) {
        return [...document.querySelectorAll('.scrolly')].map(get)
      }
      const el = typeof target === 'string' ? document.querySelector(target) : target
      if (!el) throw new Error(`scrolly: no element matches ${target}`)
      return get(el)
    }
  }

  if (typeof window !== 'undefined') window.Scrolly = Scrolly
})()
