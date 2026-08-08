/**
 * §15 the motion layer — one instance per Story, owning every write that is
 * *motion* rather than state: the `[data-scrub]` `--t` stamps, the declarative
 * camera's `--camera-transform`, and the `data-morph` view-transition wrap.
 *
 * story.ts keeps §5–§7 emission (classes, `data-active-step`, the progress
 * variables, the events) and calls in here at the five moments motion has an
 * opinion: construction, every frame, every step change, every resize, and
 * teardown. The direction is one-way — `story → motion → {camera, geometry}`:
 * motion never reads back into the story, so the core stays unaware of whether
 * a camera or a scrub exists at all.
 */

import { type CameraRig, measureShots, resolveRig, type Shots, warnOnce } from './camera'
import { cameraTransform, interpolateShot, type Shot } from './geometry'

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export class Motion {
  private _root: HTMLElement
  private _steps: HTMLElement[]
  /** `[data-scrub]` elements stamped with `--t` at init (§15.2), for teardown. */
  private _scrubs: HTMLElement[] = []
  /** §15.3: null when the graphic has no `[data-camera]` (feature is opt-in). */
  private _rig: CameraRig | null
  private _shots: Shots | null = null
  /** §15.4: the in-flight morph, tracked so the next step-change can skip it (latest wins, no queue). */
  private _transition: ViewTransition | null = null

  /**
   * `chapters` are the step ids the core exposes as `--progress-<id>` (§15.2)
   * — the only ids a `data-scrub` can bind to.
   */
  constructor(
    root: HTMLElement,
    graphic: HTMLElement | null,
    steps: HTMLElement[],
    chapters: string[]
  ) {
    this._root = root
    this._steps = steps
    this._rig = resolveRig(graphic)
    this._stampScrubs(chapters)
    this.measure()
  }

  // §15.3: shots are measured at init, step-change, and resize only — never
  // per frame. No-op when the graphic has no `[data-camera]`.
  measure(): void {
    if (this._rig) this._shots = measureShots(this._rig, this._root, this._steps)
  }

  /** Per frame: the camera's transform for the position the core just measured. */
  update(active: number, step: number): void {
    // A resolvable center is the precondition for any shot existing at all
    // (shots are only resolved when the stage measured), so guard on it once
    // rather than re-defaulting it per call.
    const center = this._shots?.center
    if (!center) return
    const shot = this._cameraShot(active, step)
    if (shot) this._root.style.setProperty('--camera-transform', cameraTransform(shot, center))
  }

  /**
   * The step change: shots re-measure against the pre-write layout, then the
   * core's §5.2 atomic write batch runs — wrapped in a view transition when
   * §15.4 `data-morph` applies. The batch is the ONLY thing `data-morph`
   * wraps; the core's progress-variable writes stay outside it.
   *
   * Feature-detect and reduced-motion both fall through to the exact
   * pre-morph path. A new step-change mid-flight skips the running transition
   * itself (latest wins, never a queue).
   */
  stepChange(write: () => void): void {
    this.measure()
    if (
      this._root.dataset.morph === undefined ||
      reducedMotion() ||
      typeof document.startViewTransition !== 'function'
    ) {
      write()
      return
    }
    this._transition?.skipTransition()
    this._transition = document.startViewTransition(write)
  }

  destroy(): void {
    // §15.4 RED-TEAM: skipTransition() stops the animation but does NOT
    // unqueue an in-flight morph's write() — the browser still runs it, which
    // is why the core guards that closure with its own destroyed flag.
    this._transition?.skipTransition()
    for (const el of this._scrubs) el.style.removeProperty('--t')
    this._scrubs = []
    this._root.style.removeProperty('--camera-transform')
    this._shots = null
  }

  // §15.3: the shot at the current scroll position. Steps without their own
  // `data-focus` hold the previous shot; between two focused steps the
  // flight plays out across the EARLIER one's own chapter progress (so the
  // camera has already arrived by the time the later step's prose appears).
  // Reduced motion snaps to the nearer shot — a cut, never a flight.
  private _cameraShot(active: number, step: number): Shot | null {
    if (!this._shots) return null
    if (active < 0) return this._shots.establishing
    const from = this._shots.held[active]
    const to = this._shots.next[active]
    if (!from || !to) return null
    return interpolateShot(from, to, reducedMotion() ? Math.round(step) : step)
  }

  // §15.2: one-time --t stamp per [data-scrub] element — valueless scrubs the
  // whole story, an id scrubs that chapter, a dangling id fails soft (no
  // stamp, console.warn) rather than breaking the page.
  private _stampScrubs(chapters: string[]): void {
    const bound = new Set(chapters)
    for (const el of this._root.querySelectorAll<HTMLElement>('[data-scrub]')) {
      const id = el.dataset.scrub
      if (!id) el.style.setProperty('--t', 'var(--story-progress)')
      else if (bound.has(id)) el.style.setProperty('--t', `var(--progress-${id})`)
      else {
        warnOnce(`scrolly: data-scrub="${id}" matches no chapter`)
        continue
      }
      this._scrubs.push(el)
    }
  }
}
