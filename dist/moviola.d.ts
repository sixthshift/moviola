/**
 * Moviola.init()          → Story[] for every .moviola on the page
 * Moviola.init(target)    → Story for a selector or element
 * Idempotent per element: re-init returns the existing Story.
 */
declare function init(): Story[];

declare function init(target: string | HTMLElement, opts?: MoviolaOptions): Story;

declare const Moviola: {
    version: string;
    init: typeof init;
};
export default Moviola;

export declare interface MoviolaEventMap {
    stepenter: StepEventDetail;
    stepexit: StepEventDetail;
    progress: ProgressDetail;
}

export declare type MoviolaEventName = keyof MoviolaEventMap;

/**
 * Public type surface. Everything moviola emits or accepts is described here;
 * the runtime contract itself (classes, attributes, CSS variables) lives in
 * SPEC §5–§7.
 */
export declare interface MoviolaOptions {
    /** Trigger line as a fraction of viewport height. `data-offset` on the element wins. */
    offset?: number;
}

export declare interface ProgressDetail extends StepDetail {
    /** 0→1 through the active step's chapter (its top to the next step's top). */
    progress: number;
    /** 0→1 through the whole story. */
    storyProgress: number;
}

export declare interface StepDetail {
    step: HTMLElement;
    /** The step's `id`, or its zero-based index as a string when it has none. */
    id: string;
    index: number;
}

export declare interface StepEventDetail extends StepDetail {
    direction: 'down' | 'up';
}

export declare class Story {
    root: HTMLElement;
    offset: number;
    graphic: HTMLElement | null;
    steps: HTMLElement[];
    /**
     * §16.1: each `[data-show]` element paired with the step keys it is shown
     * for. Membership is resolved once at construction from the step order and
     * is static for the story's life — §5.1's live geometry re-measures
     * positions, never which steps a range covers, so `crash..` means the same
     * steps after a resize as before it.
     */
    shown: Array<{
        el: HTMLElement;
        keys: Set<string>;
    }>;
    active: number;
    private _engaged;
    private _ticking;
    private _subs;
    private _io;
    private _onScroll;
    private _onResize;
    private _onKey;
    /** Steps addressable as `--progress-<id>` (§15.2), fixed at construction. */
    private _progressIds;
    /** §15's writes — the core hands it the moments, never the state (see motion.ts). */
    private _motion;
    private _destroyed;
    constructor(root: HTMLElement, opts?: MoviolaOptions);
    private _engage;
    private _tick;
    private _update;
    private _activate;
    /**
     * §16.1 membership, resolved against the step keys a step is addressed by
     * everywhere else (stepId — real id, or index fallback), so an
     * index-fallback id is never mistaken for a dangling reference.
     *
     * §15.6(a): the wording and the warn channel live here, not in
     * geometry.ts — resolveShow reports issues as data so the math stays
     * console-free. A dangling endpoint keeps the pre-range message verbatim;
     * a reversed span gets its own, since an author who inverted their step
     * order needs to be told that rather than shown an empty graphic.
     */
    private _resolveShows;
    /**
     * §15.6 structure diagnostics — the three markup shapes that leave a story
     * silently inert. Reported once per story from the init path, and never
     * acted on: a step-less story is already a no-op in _update(), and a
     * figure-less camera simply never resolves a rig, so the warn is the whole
     * fix. Nesting and emptiness are one question with two answers — an author
     * who wrapped their steps in a layout div needs to hear about the wrapper,
     * not that the story is empty.
     */
    private _warnStructure;
    private _detail;
    on<K extends MoviolaEventName>(name: K, fn: (detail: MoviolaEventMap[K]) => void): () => void;
    destroy(): void;
}

export { }
