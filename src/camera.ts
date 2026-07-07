/**
 * §15.3 the declarative camera — DOM measurement only. Shots are resolved
 * here at init/step-change/resize (never per frame, §5.3); story.ts caches
 * the result and does the per-frame interpolation with geometry.ts's pure
 * math, so no rect is read on a scroll tick.
 *
 * The camera element (`[data-camera]`) must be an SVG graphics element: its
 * children's authored coordinates (what `data-focus` targets measure in) are
 * only a stable, transform-independent space for SVG content, and
 * `getScreenCTM` is what lets a shot be resolved from the CURRENT rendered
 * layout without writing scroll position or temporarily clearing styles.
 */

import { fitZoom, type Shot } from './geometry'

export interface CameraRig {
  camera: SVGGraphicsElement
  /** The visible pinned frame shots are composed against (the `<figure>`). */
  stage: Element
}

/** `[data-camera]` opts in only when it can resolve shots (SVG content). */
export function resolveRig(graphic: Element | null): CameraRig | null {
  const camera = graphic?.querySelector('[data-camera]') ?? null
  if (!camera || !graphic || !('getScreenCTM' in camera)) return null
  return { camera: camera as unknown as SVGGraphicsElement, stage: graphic }
}

type Rect = { x: number; y: number; w: number; h: number }

const boxOf = (p1: DOMPoint, p2: DOMPoint): Rect => ({
  x: Math.min(p1.x, p2.x),
  y: Math.min(p1.y, p2.y),
  w: Math.abs(p2.x - p1.x),
  h: Math.abs(p2.y - p1.y),
})

/**
 * The stage's box in the camera's own untransformed coordinate space. The
 * stage (the sticky `<figure>`) isn't SVG content, so this goes through its
 * real rendered screen rect — which is also what makes it resize-sensitive
 * (a `data-zoom`-less shot reframes if the stage's own aspect ratio does).
 * `camera.parentNode`'s screen matrix excludes the camera's own transform by
 * construction (a transform maps an element's children into its PARENT's
 * space), so this is stable regardless of the shot the camera currently
 * happens to be showing.
 */
function stageRect(rig: CameraRig): Rect | null {
  const parent = rig.camera.parentNode as Element | null
  const ctm =
    parent && 'getScreenCTM' in parent ? (parent as SVGGraphicsElement).getScreenCTM() : null
  if (!ctm) return null
  const inv = ctm.inverse()
  const r = rig.stage.getBoundingClientRect()
  return boxOf(
    new DOMPoint(r.left, r.top).matrixTransform(inv),
    new DOMPoint(r.right, r.bottom).matrixTransform(inv)
  )
}

/**
 * `target`'s box in the camera's own untransformed coordinate space.
 * `target.getScreenCTM()` already includes whatever the camera's CURRENT
 * transform is (target is its descendant); dividing it by the camera's own
 * screen matrix cancels that transform out algebraically, so this is
 * self-correcting mid-flight rather than needing to read `target`'s
 * rendered box (which the camera's own live transform would distort).
 */
function targetRect(rig: CameraRig, target: Element): Rect | null {
  if (!('getBBox' in target && 'getScreenCTM' in target)) return null
  const el = target as SVGGraphicsElement
  const camCTM = rig.camera.getScreenCTM()
  const targetCTM = el.getScreenCTM()
  if (!camCTM || !targetCTM) return null
  const toCamera = camCTM.inverse().multiply(targetCTM)
  const box = el.getBBox()
  return boxOf(
    new DOMPoint(box.x, box.y).matrixTransform(toCamera),
    new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(toCamera)
  )
}

export interface Shots {
  /** The root's own shot (§15.3: the establishing shot while no step is active). */
  establishing: Shot | null
  /** Per step: its own shot, or the nearest earlier step's (holds forward). */
  held: (Shot | null)[]
  /** Per step: the nearest *later* step's own shot, target of that step's flight. */
  next: (Shot | null)[]
  /** The stage's own center, in camera-local units — the flight's destination. */
  center: { x: number; y: number } | null
}

/**
 * Resolve every focused step's shot. A `data-focus` selector matching
 * nothing warns once and is treated as absent (hold, never a throw or a
 * jump to identity — §15.3).
 */
export function measureShots(rig: CameraRig, root: HTMLElement, steps: HTMLElement[]): Shots {
  const stage = stageRect(rig)

  const resolve = (el: HTMLElement): Shot | null => {
    const selector = el.dataset.focus
    if (!selector) return null
    const target = document.querySelector(selector)
    if (!target) {
      console.warn(`scrolly: data-focus="${selector}" matches no element`)
      return null
    }
    const t = targetRect(rig, target)
    if (!t || !stage) return null
    const zoom = Number.parseFloat(el.dataset.zoom ?? '')
    return {
      cx: t.x + t.w / 2,
      cy: t.y + t.h / 2,
      k: Number.isFinite(zoom) ? zoom : fitZoom(t.w, t.h, stage.w, stage.h),
    }
  }

  const establishing = resolve(root)
  const own = steps.map(resolve)

  const held: (Shot | null)[] = []
  let last = establishing
  for (const shot of own) held.push((last = shot ?? last))

  const next = held.map((h, i) => own.slice(i + 1).find((s): s is Shot => s !== null) ?? h)

  const center = stage ? { x: stage.x + stage.w / 2, y: stage.y + stage.h / 2 } : null

  return { establishing, held, next, center }
}
