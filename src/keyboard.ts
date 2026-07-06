/**
 * ←/→ step between chapters while the story is on screen. Vertical scroll
 * keys stay the browser's — stepping is an enhancement, never scroll-jacking
 * (§7.4).
 */

export interface KeyboardHost {
  active: number
  steps: HTMLElement[]
  offset: number
}

export function handleKeydown(e: KeyboardEvent, host: KeyboardHost): void {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
  const t = e.target as HTMLElement | null
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
  const next = host.active + (e.key === 'ArrowRight' ? 1 : -1)
  const step = host.steps[next]
  if (!step) return
  e.preventDefault()
  const trigger = window.innerHeight * host.offset
  const top = step.getBoundingClientRect().top + window.scrollY
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: top - trigger + 2, behavior: reduce ? 'auto' : 'smooth' })
}
