/**
 * Event plumbing. moviola's events are plain bubbling CustomEvents
 * (`moviola:stepenter` …) on the story root, so any framework can listen
 * without this module — `subscribe` is only the typed sugar behind
 * `story.on()` (§7.1/§7.2).
 */

import type { MoviolaEventMap, MoviolaEventName } from './types'

export function emit<K extends MoviolaEventName>(
  root: HTMLElement,
  name: K,
  detail: MoviolaEventMap[K]
): void {
  root.dispatchEvent(new CustomEvent(`moviola:${name}`, { detail, bubbles: true }))
}

/** Listen on the story root; returns an unsubscribe function. */
export function subscribe<K extends MoviolaEventName>(
  root: HTMLElement,
  name: K,
  fn: (detail: MoviolaEventMap[K]) => void
): () => void {
  const type = `moviola:${name}`
  const handler = (e: Event) => fn((e as CustomEvent<MoviolaEventMap[K]>).detail)
  root.addEventListener(type, handler)
  return () => root.removeEventListener(type, handler)
}
