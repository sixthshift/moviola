/**
 * Pure scroll geometry — no DOM, just numbers. The state machine's math
 * lives here so it can be unit-tested against the SPEC §5 semantics without
 * a browser.
 *
 * All positions are viewport-relative (as returned by getBoundingClientRect)
 * and `trigger` is the trigger line's distance from the viewport top.
 */

export const clamp = (v: number): number => Math.min(1, Math.max(0, v))

/**
 * Active step = the last step whose top has crossed the trigger line (§5.1).
 * Steps are scanned in document order and the scan stops at the first top
 * still below the trigger, so out-of-order geometry never activates a later
 * step early. Returns -1 while no step has crossed.
 */
export function activeIndex(stepTops: readonly number[], trigger: number): number {
  let active = -1
  for (const [i, top] of stepTops.entries()) {
    if (top > trigger) break
    active = i
  }
  return active
}

/**
 * 0→1 travel of the trigger line from the first step's top to the last
 * step's bottom. Degenerate (zero-height) spans guard with max(1, …) rather
 * than dividing by zero.
 */
export function storyProgress(firstTop: number, lastBottom: number, trigger: number): number {
  return clamp((trigger - firstTop) / Math.max(1, lastBottom - firstTop))
}

/**
 * 0→1 through a chapter: from the active step's top to `end` — the next
 * step's top, or the step's own bottom when it is the last (§5.2).
 */
export function stepProgress(top: number, end: number, trigger: number): number {
  return clamp((trigger - top) / Math.max(1, end - top))
}
