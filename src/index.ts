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

import { getOrCreateStory, type Story } from './story'
import type { ScrollyOptions } from './types'

/**
 * Scrolly.init()          → Story[] for every .scrolly on the page
 * Scrolly.init(target)    → Story for a selector or element
 * Idempotent per element: re-init returns the existing Story.
 */
function init(): Story[]
function init(target: string | HTMLElement, opts?: ScrollyOptions): Story
function init(target?: string | HTMLElement, opts?: ScrollyOptions): Story | Story[] {
  if (target === undefined) {
    return [...document.querySelectorAll<HTMLElement>('.scrolly')].map(el => getOrCreateStory(el))
  }
  const el = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target
  if (!el) throw new Error(`scrolly: no element matches ${target}`)
  return getOrCreateStory(el, opts)
}

const Scrolly = {
  version: '0.0.1',
  init,
}

export default Scrolly
export type {
  ProgressDetail,
  ScrollyEventMap,
  ScrollyEventName,
  ScrollyOptions,
  StepDetail,
  StepEventDetail,
} from './types'
export type { Story }
