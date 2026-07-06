/**
 * Event plumbing. scrolly's events are plain bubbling CustomEvents
 * (`scrolly:stepenter` …) on the story root, so any framework can listen
 * without this module — `subscribe` is only the typed sugar behind
 * `story.on()` (§7.1/§7.2).
 */

import type { ScrollyEventMap, ScrollyEventName } from './types'

export function emit<K extends ScrollyEventName>(
  root: HTMLElement,
  name: K,
  detail: ScrollyEventMap[K]
): void {
  root.dispatchEvent(new CustomEvent(`scrolly:${name}`, { detail, bubbles: true }))
}

/** Listen on the story root; returns an unsubscribe function. */
export function subscribe<K extends ScrollyEventName>(
  root: HTMLElement,
  name: K,
  fn: (detail: ScrollyEventMap[K]) => void
): () => void {
  const type = `scrolly:${name}`
  const handler = (e: Event) => fn((e as CustomEvent<ScrollyEventMap[K]>).detail)
  root.addEventListener(type, handler)
  return () => root.removeEventListener(type, handler)
}
