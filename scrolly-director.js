/**
 * scrolly-director.js — the authoring overlay (SPEC §15.6.2).
 *
 * Opt-in dev tool, not part of the shipped library (like themes/*.css):
 * one <script src="scrolly-director.js"> draws the trigger line, a chapter
 * rail (click-to-jump), and a live state chip over whichever `.scrolly`
 * story is nearest the viewport. Zero diffs to scrolly's core files;
 * self-contained and file://-safe. Toggle with the 'd' key, guarded
 * against typing contexts the same way src/keyboard.ts guards its own
 * stepping.
 *
 * The rail's jump reuses keyboard.ts's exact trigger math (top - trigger +
 * 2, smooth unless the reader prefers reduced motion) — the camera it
 * drives is the reader's own scroll position, never scrollTop-jacked.
 */
;(() => {
  const DEFAULT_OFFSET = 0.5
  const VALID_IDENT = /^[A-Za-z0-9_-]+$/

  let root = null
  let ui = null
  let lastStory = null
  let rafId = null

  const stories = () => [...document.querySelectorAll('.scrolly')]

  const storyOffset = story => {
    const raw = story.dataset.offset
    const n = raw !== undefined ? parseFloat(raw) : DEFAULT_OFFSET
    return Number.isNaN(n) ? DEFAULT_OFFSET : n
  }

  const storySteps = story => [...story.querySelectorAll(':scope > .step')]

  const stepId = (step, index) => step.id || String(index)

  // The story whose trigger concerns the reader right now: on-screen wins
  // (distance 0); off-screen, the nearest one above or below.
  const currentStory = all => {
    let best = null
    let bestDist = Infinity
    for (const s of all) {
      const r = s.getBoundingClientRect()
      const dist =
        r.top > window.innerHeight ? r.top - window.innerHeight : r.bottom < 0 ? -r.bottom : 0
      if (dist < bestDist) {
        bestDist = dist
        best = s
      }
    }
    return best
  }

  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // Same math as src/keyboard.ts's ArrowLeft/ArrowRight stepping.
  const scrollStepToTrigger = (story, step) => {
    const trigger = window.innerHeight * storyOffset(story)
    const top = step.getBoundingClientRect().top + window.scrollY
    window.scrollTo({ top: top - trigger + 2, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  const build = () => {
    const el = document.createElement('div')
    el.setAttribute('data-scrolly-director', '')

    const line = document.createElement('div')
    line.setAttribute('data-scrolly-director-line', '')
    line.style.cssText =
      'position:fixed;left:0;right:0;height:0;border-top:2px dashed #f0a;' +
      'z-index:2147483000;pointer-events:none;'

    const label = document.createElement('span')
    label.setAttribute('data-scrolly-director-label', '')
    label.style.cssText =
      'position:absolute;left:4px;top:2px;font:11px/1.4 monospace;' +
      'color:#f0a;background:#000;padding:0 4px;'
    line.appendChild(label)

    const rail = document.createElement('div')
    rail.setAttribute('data-scrolly-director-rail', '')
    rail.style.cssText =
      'position:fixed;top:8px;right:8px;z-index:2147483000;font:11px/1.4 monospace;' +
      'background:#000;color:#fff;padding:4px;max-height:40vh;overflow:auto;'

    const chip = document.createElement('div')
    chip.setAttribute('data-scrolly-director-chip', '')
    chip.style.cssText =
      'position:fixed;bottom:8px;right:8px;z-index:2147483000;font:11px/1.4 monospace;' +
      'background:#000;color:#0f0;padding:4px;white-space:pre;'

    el.appendChild(line)
    el.appendChild(rail)
    el.appendChild(chip)
    document.body.appendChild(el)
    return { el, line, label, rail, chip }
  }

  const renderRail = (view, story) => {
    view.rail.textContent = ''
    if (!story) return
    storySteps(story).forEach((step, index) => {
      const id = stepId(step, index)
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = id
      btn.dataset.stepId = id
      btn.style.cssText =
        'display:block;width:100%;text-align:left;background:none;color:inherit;' +
        'border:0;padding:2px 4px;cursor:pointer;font:inherit;'
      btn.addEventListener('click', () => scrollStepToTrigger(story, step))
      view.rail.appendChild(btn)
    })
  }

  const renderChip = (view, story) => {
    if (!story) {
      view.chip.textContent = 'scrolly-director: no story'
      return
    }
    const lines = []
    lines.push(`active: ${story.getAttribute('data-active-step') || '—'}`)
    lines.push(`step-progress: ${story.style.getPropertyValue('--step-progress') || '0'}`)
    lines.push(`story-progress: ${story.style.getPropertyValue('--story-progress') || '0'}`)
    for (const step of storySteps(story)) {
      if (step.id && VALID_IDENT.test(step.id)) {
        const prop = `--progress-${step.id}`
        lines.push(`${prop}: ${story.style.getPropertyValue(prop) || '0'}`)
      }
    }
    const figure = story.querySelector(':scope > figure')
    const shown = figure ? figure.querySelectorAll('[data-show].is-shown').length : 0
    lines.push(`is-shown: ${shown}`)
    view.chip.textContent = lines.join('\n')
  }

  const update = () => {
    rafId = null
    const story = currentStory(stories())
    if (story !== lastStory) {
      renderRail(ui, story)
      lastStory = story
    }
    if (story) {
      const top = window.innerHeight * storyOffset(story)
      ui.line.style.display = ''
      ui.line.style.top = `${top}px`
      ui.label.textContent = `trigger × ${storyOffset(story).toFixed(2)}`
    } else {
      ui.line.style.display = 'none'
    }
    renderChip(ui, story)
  }

  const schedule = () => {
    if (rafId !== null) return
    rafId = requestAnimationFrame(update)
  }

  const mount = () => {
    if (root || stories().length === 0) return
    ui = build()
    root = ui.el
    lastStory = null
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    update()
  }

  const unmount = () => {
    if (!root) return
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    root.remove()
    root = null
    ui = null
    lastStory = null
  }

  const isTypingTarget = t =>
    !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

  const onKeydown = e => {
    if (e.key !== 'd' && e.key !== 'D') return
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    if (isTypingTarget(e.target)) return
    if (root) unmount()
    else mount()
  }

  // RED-TEAM: a page with zero stories is a true no-op — no listeners, no
  // nodes, nothing that could ever throw.
  if (stories().length > 0) {
    window.addEventListener('keydown', onKeydown)
    mount()
  }
})()
