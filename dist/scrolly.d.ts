/**
 * Scrolly.init()          → Story[] for every .scrolly on the page
 * Scrolly.init(target)    → Story for a selector or element
 * Idempotent per element: re-init returns the existing Story.
 */
declare function init(): Story[];

declare function init(target: string | HTMLElement, opts?: ScrollyOptions): Story;

export declare interface ProgressDetail extends StepDetail {
    /** 0→1 through the active step's chapter (its top to the next step's top). */
    progress: number;
    /** 0→1 through the whole story. */
    storyProgress: number;
}

declare const Scrolly: {
    version: string;
    init: typeof init;
};
export default Scrolly;

export declare interface ScrollyEventMap {
    stepenter: StepEventDetail;
    stepexit: StepEventDetail;
    progress: ProgressDetail;
}

export declare type ScrollyEventName = keyof ScrollyEventMap;

/**
 * Public type surface. Everything scrolly emits or accepts is described here;
 * the runtime contract itself (classes, attributes, CSS variables) lives in
 * SPEC §5–§7.
 */
export declare interface ScrollyOptions {
    /** Trigger line as a fraction of viewport height. `data-offset` on the element wins. */
    offset?: number;
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
    shown: HTMLElement[];
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
    constructor(root: HTMLElement, opts?: ScrollyOptions);
    private _engage;
    private _tick;
    private _update;
    private _activate;
    private _warnDanglingShows;
    private _detail;
    on<K extends ScrollyEventName>(name: K, fn: (detail: ScrollyEventMap[K]) => void): () => void;
    destroy(): void;
}

export { }
