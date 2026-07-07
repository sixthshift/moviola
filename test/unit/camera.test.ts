// @vitest-environment happy-dom
/*
 * §15.3 camera measurement, driven headlessly: happy-dom's `getScreenCTM`
 * always returns identity and `getBoundingClientRect` always returns zeros
 * (it doesn't compute real SVG layout), so both are stubbed directly, like
 * story.test.ts's IntersectionObserver stub — this file owns the
 * resolution/hold/warn/matrix-cancellation contract; the real getScreenCTM
 * behavior against a live viewBox is e2e's job (motion.spec.ts).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { measureShots, resolveRig } from '../../src/camera'
import { interpolateShot, type Shot } from '../../src/geometry'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Stage rect (an HTML element's real rendered screen box). */
const setRect = (el: Element, x: number, y: number, w: number, h: number) => {
  ;(el as HTMLElement).getBoundingClientRect = () =>
    ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h }) as DOMRect
}

/** A target's own local shape (SVG `getBBox`, unaffected by any transform). */
const setBBox = (el: SVGGraphicsElement, x: number, y: number, w: number, h: number) => {
  el.getBBox = () => ({ x, y, width: w, height: h }) as DOMRect
}

const mkStep = (root: HTMLElement, id: string, focus?: string, zoom?: string): HTMLElement => {
  const s = document.createElement('section')
  s.className = 'step'
  s.id = id
  if (focus) s.dataset.focus = focus
  if (zoom) s.dataset.zoom = zoom
  root.appendChild(s)
  return s
}

function buildBase() {
  document.body.innerHTML = `
    <article id="story" class="scrolly">
      <figure></figure>
    </article>
  `
  const root = document.getElementById('story') as HTMLElement
  const figure = root.querySelector('figure') as HTMLElement
  return { root, figure }
}

function build() {
  const { root, figure } = buildBase()
  const svg = document.createElementNS(SVG_NS, 'svg')
  const camera = document.createElementNS(SVG_NS, 'g')
  camera.setAttribute('data-camera', '')
  svg.appendChild(camera)
  figure.appendChild(svg)

  const wuhan = document.createElementNS(SVG_NS, 'circle')
  wuhan.id = 'wuhan'
  camera.appendChild(wuhan)
  const york = document.createElementNS(SVG_NS, 'circle')
  york.id = 'york'
  camera.appendChild(york)

  return { root, figure, svg, camera, wuhan, york }
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveRig', () => {
  test('null when the graphic has no [data-camera]', () => {
    const { figure } = buildBase()
    expect(resolveRig(figure)).toBeNull()
  })

  test('null for a null graphic', () => {
    expect(resolveRig(null)).toBeNull()
  })

  test('null when the camera-tagged element cannot resolve a screen matrix (plain HTML)', () => {
    const { figure } = buildBase()
    const div = document.createElement('div')
    div.setAttribute('data-camera', '')
    figure.appendChild(div)
    expect(resolveRig(figure)).toBeNull()
  })

  test('resolves camera + stage when [data-camera] is SVG content', () => {
    const { figure, camera } = build()
    const rig = resolveRig(figure)
    expect(rig?.camera).toBe(camera)
    expect(rig?.stage).toBe(figure)
  })
})

describe('measureShots', () => {
  test('own shot / fit default / explicit zoom / dangling hold+warn / fill-forward / next', () => {
    const { root, figure, wuhan, york } = build()
    setRect(figure, 0, 0, 1000, 1000) // stage: 1000x1000, center (500,500)
    setBBox(wuhan, 400, 475, 200, 50) // center (500, 500), 200x50
    setBBox(york, 100, 100, 800, 800) // center (500, 500), 800x800

    const a = mkStep(root, 'a', '#wuhan') // default fit
    const b = mkStep(root, 'b', '#missing') // dangling
    const c = mkStep(root, 'c', '#york', '3') // explicit zoom
    const d = mkStep(root, 'd') // no focus at all

    const rig = resolveRig(figure)
    if (!rig) throw new Error('expected a resolvable rig')
    const shots = measureShots(rig, root, [a, b, c, d])

    // fit: 0.7 * min(1000/200, 1000/50) = 0.7 * 5 = 3.5
    expect(shots.held[0]).toEqual({ cx: 500, cy: 500, k: 3.5 })
    // "a" (focused) flies toward the nearest later own shot — c's — across
    // its OWN chapter, so it has already ARRIVED at c's shot by the chapter
    // boundary. "b" is dangling (no resolvable focus): it holds that
    // ARRIVED shot, not "a"'s own (defective-old-behavior) shot — a
    // dangling/unfocused step never replays a flight that already landed.
    expect(shots.next[0]).toEqual({ cx: 500, cy: 500, k: 3 })
    expect(shots.held[1]).toEqual(shots.next[0])
    // explicit data-zoom wins over fit
    expect(shots.held[2]).toEqual({ cx: 500, cy: 500, k: 3 })
    // no data-focus at all: still holds the arrived shot forward
    expect(shots.held[3]).toEqual(shots.held[2])

    // "next" is each step's own flight target. "a" flies to c's shot; c is
    // the last focused step (nothing further to fly toward) so it holds at
    // its own shot; "b" and "d" are unfocused/dangling, so `next` is
    // identical to `held` at their index — a hold, never a fly.
    expect(shots.next[1]).toEqual(shots.held[1])
    expect(shots.next[2]).toEqual(shots.held[2])
    expect(shots.next[3]).toEqual(shots.held[3])

    // The hold invariant made explicit: interpolating a held/dangling
    // step's own held->next pair is a constant at every progress value —
    // never a re-flown flight across its own chapter. (Compared against a
    // t=0 baseline rather than the raw shot, since log/exp round-tripping
    // through interpolateShot isn't bit-identical to the un-interpolated
    // value — it IS identical across every t, which is what's under test.)
    const heldB = interpolateShot(shots.held[1] as Shot, shots.next[1] as Shot, 0)
    const heldD = interpolateShot(shots.held[3] as Shot, shots.next[3] as Shot, 0)
    for (const t of [0.25, 0.5, 0.75, 1]) {
      expect(interpolateShot(shots.held[1] as Shot, shots.next[1] as Shot, t)).toEqual(heldB)
      expect(interpolateShot(shots.held[3] as Shot, shots.next[3] as Shot, t)).toEqual(heldD)
    }

    expect(shots.center).toEqual({ x: 500, y: 500 })
    expect(shots.establishing).toBeNull()

    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('scrolly:'))
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('data-focus="#missing"'))
  })

  // Regression: an unfocused step sandwiched between two focused steps used
  // to interpolate from the EARLIER step's own shot toward the LATER step's
  // shot across its OWN chapter too — replaying a flight that had already
  // completed during the earlier step's chapter. Its transform must instead
  // be a constant equal to that flight's arrival endpoint (§15.3: "steps
  // without data-focus hold the previous shot").
  test('an unfocused step between two focused steps holds a constant transform at the previous flight’s arrival endpoint, never re-flying', () => {
    const { root, figure, wuhan, york } = build()
    setRect(figure, 0, 0, 1000, 1000)
    setBBox(wuhan, 450, 450, 100, 100) // #a: center (500, 500)
    setBBox(york, 150, 150, 100, 100) // #b: center (200, 200) — far from #a

    const one = mkStep(root, 'one', '#wuhan')
    const hold = mkStep(root, 'hold') // no data-focus: must hold
    const two = mkStep(root, 'two', '#york')

    const rig = resolveRig(figure)
    if (!rig) throw new Error('expected a resolvable rig')
    const shots = measureShots(rig, root, [one, hold, two])

    const shotA = shots.held[0] // "one"'s own shot
    const shotB = shots.held[2] // "two"'s own shot
    expect(shotA).not.toEqual(shotB) // the two shots really do differ

    // "one" flies A -> B across its own chapter, arriving at B by its end.
    expect(shots.next[0]).toEqual(shotB)

    // "hold" starts already arrived at B, and stays there — held and next
    // both equal B, so there is nothing left to interpolate.
    expect(shots.held[1]).toEqual(shotB)
    expect(shots.next[1]).toEqual(shotB)

    // Constant at every progress value through "hold"'s own chapter —
    // never a re-flown A -> B flight.
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const shot = interpolateShot(shots.held[1] as Shot, shots.next[1] as Shot, t)
      expect(shot.cx).toBeCloseTo((shotB as Shot).cx, 10)
      expect(shot.cy).toBeCloseTo((shotB as Shot).cy, 10)
      expect(shot.k).toBeCloseTo((shotB as Shot).k, 10)
    }
  })

  test('root data-focus resolves the establishing shot', () => {
    const { root, figure, wuhan } = build()
    setRect(figure, 0, 0, 1000, 1000)
    setBBox(wuhan, 450, 450, 100, 100) // center (500, 500)
    root.dataset.focus = '#wuhan'

    const rig = resolveRig(figure)
    if (!rig) throw new Error('expected a resolvable rig')
    const d = mkStep(root, 'd') // no step focuses anything
    const shots = measureShots(rig, root, [d])

    expect(shots.establishing).toEqual({ cx: 500, cy: 500, k: 7 }) // 0.7*min(10,10)
    expect(shots.held[0]).toEqual(shots.establishing) // holds the establishing shot
    expect(shots.next[0]).toEqual(shots.establishing) // nothing further to fly toward
  })

  test("the stage's own screen rect is converted through the camera parent's screen matrix", () => {
    const { root, figure, svg, wuhan } = build()
    setRect(figure, 0, 0, 2000, 2000) // 2000px stage, at 2x scale => 1000 local units
    setBBox(wuhan, 450, 475, 100, 50) // already in local units: center (500, 500)
    // the svg (camera's parent) is rendered at 2x: 1 local unit = 2 screen px
    svg.getScreenCTM = () => new DOMMatrix().scale(2)

    const rig = resolveRig(figure)
    if (!rig) throw new Error('expected a resolvable rig')
    const a = mkStep(root, 'a', '#wuhan')
    const shots = measureShots(rig, root, [a])

    // stage's 2000px screen rect / 2x CTM = 1000x1000 local units
    expect(shots.held[0]).toEqual({ cx: 500, cy: 500, k: 0.7 * Math.min(1000 / 100, 1000 / 50) })
    expect(shots.center).toEqual({ x: 500, y: 500 })
  })

  test("a target's own bbox is measured through camera-vs-target screen matrices, canceling the camera's current transform", () => {
    const { root, figure, camera, wuhan } = build()
    setRect(figure, 0, 0, 1000, 1000)
    setBBox(wuhan, 0, 0, 10, 10) // target's own local shape

    // Simulate the camera mid-flight (an arbitrary live --camera-transform)
    // and a target with no transform of its own beyond the camera's: its
    // screen matrix is identical to the camera's. The measured bbox must
    // come out exactly as authored (0,0,10,10), independent of that matrix.
    const live = new DOMMatrix().translate(37, -19).scale(4.2)
    camera.getScreenCTM = () => live
    wuhan.getScreenCTM = () => live

    const rig = resolveRig(figure)
    if (!rig) throw new Error('expected a resolvable rig')
    const a = mkStep(root, 'a', '#wuhan')
    const shots = measureShots(rig, root, [a])

    expect(shots.held[0]?.cx).toBeCloseTo(5, 6)
    expect(shots.held[0]?.cy).toBeCloseTo(5, 6)
  })

  test('a target nested behind an additional transform is still measured correctly', () => {
    const { root, figure, camera, wuhan } = build()
    setRect(figure, 0, 0, 1000, 1000)
    setBBox(wuhan, 0, 0, 10, 10)

    // Camera's own screen matrix vs. target's: target sits behind an extra
    // 3x scale relative to the camera (e.g. an intermediate <g scale(3)>).
    camera.getScreenCTM = () => new DOMMatrix().scale(2)
    wuhan.getScreenCTM = () => new DOMMatrix().scale(2).scale(3)

    const rig = resolveRig(figure)
    if (!rig) throw new Error('expected a resolvable rig')
    const a = mkStep(root, 'a', '#wuhan')
    const shots = measureShots(rig, root, [a])

    // bbox (0,0,10,10) scaled 3x into the camera's own frame -> center (15,15)
    expect(shots.held[0]?.cx).toBeCloseTo(15, 6)
    expect(shots.held[0]?.cy).toBeCloseTo(15, 6)
  })
})
