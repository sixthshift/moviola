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

// §15.6: shared by camera.ts and story.ts so a referential mistake — dangling
// data-scrub/data-focus/data-show, or an unused data-camera rig — warns
// exactly once no matter how many times the offending measure/stamp re-runs
// (camera shots re-measure on every resize, §5.3).
const warned = new Set<string>()
export function warnOnce(message: string): void {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(message)
}

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

/**
 * §16 what a `data-focus` value asks for. The coordinate form carries a box
 * in the camera's own untransformed space, which is the same space
 * `targetRect` measures a selector's target into — so the two forms meet at
 * exactly the point framing is decided and cannot drift apart.
 */
export type FocusSpec =
  | { kind: 'box'; box: Rect }
  | { kind: 'selector'; selector: string }
  | { kind: 'malformed'; value: string }

/**
 * §16: disambiguate on the FIRST CHARACTER — a digit or `-` means raw
 * coordinates, anything else is a selector. Dead simple on purpose, and that
 * pins two traps: `".5 0 10 10"` and `"+50 0 200 100"` take the SELECTOR path
 * (and fail soft as "matches no element"), because an author writes `0.5`, not
 * `.5`. Sniffing further would buy those two values at the cost of the rule
 * itself — an author could no longer tell which path a value takes by looking
 * at its first character.
 */
export function parseFocus(value: string): FocusSpec {
  const first = value[0] ?? ''
  if (first !== '-' && !(first >= '0' && first <= '9')) return { kind: 'selector', selector: value }
  // `Number`, not `parseFloat`: a half-numeric token ("30q") is an authoring
  // mistake to report, never a prefix to salvage.
  const parts = value.trim().split(/\s+/).map(Number)
  // The tuple cast is sound because the arity check below gates every use of
  // the destructured values.
  const [x, y, w, h] = parts as [number, number, number, number]
  if (parts.length !== 4 || !parts.every(Number.isFinite) || w <= 0 || h <= 0) {
    return { kind: 'malformed', value }
  }
  return { kind: 'box', box: { x, y, w, h } }
}

/**
 * A selector string the CSS engine cannot even parse gets the disposition
 * every other unresolvable focus gets — no match — rather than the
 * DOMException `querySelector` throws, which would propagate out of
 * `Scrolly.init` and take the whole story down (§15.6: fail-soft always, a
 * warning page keeps working). Not hypothetical: the first-character rule
 * deliberately routes `".5 0 10 10"` and `"+50 0 200 100"` here, and neither
 * is valid CSS.
 */
function queryFocus(selector: string): Element | null {
  try {
    return document.querySelector(selector)
  } catch {
    return null
  }
}

/**
 * The subject box a `data-focus` frames, in the camera's own untransformed
 * space. Null is the fail-soft disposition §15.3 pins for every value that
 * resolves to no box — absent, malformed coordinates, or a selector matching
 * nothing: warn once (§15.6) and let the caller hold.
 */
function focusBox(rig: CameraRig, el: HTMLElement): Rect | null {
  const value = el.dataset.focus
  if (!value) return null

  const spec = parseFocus(value)
  if (spec.kind === 'box') return spec.box
  if (spec.kind === 'malformed') {
    warnOnce(`scrolly: data-focus="${value}" is not four finite numbers x y w h`)
    return null
  }

  const target = queryFocus(spec.selector)
  if (!target) {
    warnOnce(`scrolly: data-focus="${value}" matches no element`)
    return null
  }
  return targetRect(rig, target)
}

export interface Shots {
  /** The root's own shot (§15.3: the establishing shot while no step is active). */
  establishing: Shot | null
  /**
   * Per step: the shot at the START of its own chapter — its own shot when
   * it has one, else wherever the story has already ARRIVED (the previous
   * focused step's flight target, chained through any holds in between).
   */
  held: (Shot | null)[]
  /**
   * Per step: the shot its own chapter progress is measured toward. For a
   * focused step this is the nearest *later* step's own shot (the flight
   * target — §15.3: "interpolates across the earlier step's chapter"); for
   * an unfocused or dangling step this is identical to `held` at that
   * index, so interpolating between them is a no-op constant rather than a
   * replayed flight (§15.3: "steps without data-focus hold the previous
   * shot" — the shot already ARRIVED at, never the flight that landed it).
   */
  next: (Shot | null)[]
  /** The stage's own center, in camera-local units — the flight's destination. */
  center: { x: number; y: number } | null
  /**
   * The stage's own width, in the same camera-local units — the world width
   * §15.3's flight measures view width against (`w ≡ worldWidth / k`). Null
   * exactly when `center` is null: both come from the one stage measurement
   * that is already the precondition for any shot resolving at all.
   */
  worldWidth: number | null
}

/**
 * Resolve every focused step's shot. A `data-focus` that resolves to no box —
 * a selector matching nothing, or malformed coordinates — warns once and is
 * treated as absent (hold, never a throw or a jump to identity — §15.3).
 */
export function measureShots(rig: CameraRig, root: HTMLElement, steps: HTMLElement[]): Shots {
  // §15.6(d): a rig with no data-focus anywhere is a graphic that will
  // never move — almost always a forgotten attribute, not an intentional
  // static shot (a static shot is better served by never adding data-camera).
  if (!root.hasAttribute('data-focus') && !steps.some(s => s.hasAttribute('data-focus'))) {
    warnOnce('scrolly: data-camera has no data-focus anywhere — the camera never moves')
  }

  const stage = stageRect(rig)

  // Both `data-focus` forms share every line below the fork, so a raw box and
  // a measured bbox cannot frame differently: one fit default, one `data-zoom`
  // override, one shot shape.
  const resolve = (el: HTMLElement): Shot | null => {
    const box = focusBox(rig, el)
    if (!box || !stage) return null
    const zoom = Number.parseFloat(el.dataset.zoom ?? '')
    return {
      cx: box.x + box.w / 2,
      cy: box.y + box.h / 2,
      k: Number.isFinite(zoom) ? zoom : fitZoom(box.w, box.h, stage.w, stage.h),
    }
  }

  const establishing = resolve(root)
  const own = steps.map(resolve)

  // One forward pass tracking `arrived` — the shot the story has actually
  // reached by the end of the previous chapter. A focused step starts its
  // own chapter at its own shot (which by construction already equals
  // `arrived`: every earlier flight's target is exactly the next own shot,
  // i.e. this one) and flies toward the next own shot ahead, if any. An
  // unfocused/dangling step never flies: it starts AND ends its chapter at
  // `arrived`, holding the shot already reached rather than replaying
  // whatever flight most recently landed there.
  const held: (Shot | null)[] = []
  const next: (Shot | null)[] = []
  let arrived = establishing
  own.forEach((shot, i) => {
    const from = shot ?? arrived
    held.push(from)
    const later = own.slice(i + 1).find((s): s is Shot => s !== null)
    const to = shot ? (later ?? shot) : from
    next.push(to)
    arrived = to
  })

  const center = stage ? { x: stage.x + stage.w / 2, y: stage.y + stage.h / 2 } : null

  return { establishing, held, next, center, worldWidth: stage ? stage.w : null }
}
