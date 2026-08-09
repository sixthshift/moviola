/*!
 * moviola — the scrollytelling framework
 *
 * You write the DOM, moviola runs the state machine, effects live in your CSS.
 *
 * Document model:
 *   <article class="moviola" data-layout="side-right" data-offset="0.5">
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
 *   moviola:stepenter · moviola:stepexit · moviola:progress
 */

import { getOrCreateStory, type Story } from './story'
import type { MoviolaOptions } from './types'

/**
 * Moviola.init()          → Story[] for every .moviola on the page
 * Moviola.init(target)    → Story for a selector or element
 * Idempotent per element: re-init returns the existing Story.
 */
function init(): Story[]
function init(target: string | HTMLElement, opts?: MoviolaOptions): Story
function init(target?: string | HTMLElement, opts?: MoviolaOptions): Story | Story[] {
  if (target === undefined) {
    return [...document.querySelectorAll<HTMLElement>('.moviola')].map(el => getOrCreateStory(el))
  }
  const el = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target
  if (!el) throw new Error(`moviola: no element matches ${target}`)
  return getOrCreateStory(el, opts)
}

const Moviola = {
  version: '0.1.0',
  init,
}

export default Moviola
export type {
  MoviolaEventMap,
  MoviolaEventName,
  MoviolaOptions,
  ProgressDetail,
  StepDetail,
  StepEventDetail,
} from './types'
export type { Story }
