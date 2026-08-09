/**
 * Public type surface. Everything moviola emits or accepts is described here;
 * the runtime contract itself (classes, attributes, CSS variables) lives in
 * SPEC §5–§7.
 */

export interface MoviolaOptions {
  /** Trigger line as a fraction of viewport height. `data-offset` on the element wins. */
  offset?: number
}

export interface StepDetail {
  step: HTMLElement
  /** The step's `id`, or its zero-based index as a string when it has none. */
  id: string
  index: number
}

export interface StepEventDetail extends StepDetail {
  direction: 'down' | 'up'
}

export interface ProgressDetail extends StepDetail {
  /** 0→1 through the active step's chapter (its top to the next step's top). */
  progress: number
  /** 0→1 through the whole story. */
  storyProgress: number
}

export interface MoviolaEventMap {
  stepenter: StepEventDetail
  stepexit: StepEventDetail
  progress: ProgressDetail
}

export type MoviolaEventName = keyof MoviolaEventMap
