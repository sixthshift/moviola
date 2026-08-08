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
//#region src/geometry.ts
/**
* Pure scroll geometry — DOM-free and console-free. The state machine's math
* (and the §16 token grammar that math is addressed by) lives here so it can
* be unit-tested against the SPEC semantics without a browser.
*
* All positions are viewport-relative (as returned by getBoundingClientRect)
* and `trigger` is the trigger line's distance from the viewport top.
*/
var clamp = (v) => Math.min(1, Math.max(0, v));
/**
* Active step = the last step whose top has crossed the trigger line (§5.1).
* Steps are scanned in document order and the scan stops at the first top
* still below the trigger, so out-of-order geometry never activates a later
* step early. Returns -1 while no step has crossed.
*/
function activeIndex(stepTops, trigger) {
	let active = -1;
	for (const [i, top] of stepTops.entries()) {
		if (top > trigger) break;
		active = i;
	}
	return active;
}
/**
* 0→1 travel of the trigger line from the first step's top to the last
* step's bottom. Degenerate (zero-height) spans guard with max(1, …) rather
* than dividing by zero.
*/
function storyProgress(firstTop, lastBottom, trigger) {
	return clamp((trigger - firstTop) / Math.max(1, lastBottom - firstTop));
}
/**
* 0→1 through a chapter: from the active step's top to `end` — the next
* step's top, or the step's own bottom when it is the last (§5.2).
*/
function stepProgress(top, end, trigger) {
	return clamp((trigger - top) / Math.max(1, end - top));
}
/**
* Per-step chapter progress (§15.2): the active step's chapter is
* `stepProgress`; chapters already passed hold `1`; chapters not yet
* reached are `0`. Both `tops` and `ends` are indexed by step, `ends[i]`
* being the next step's top or (for the last step) its own bottom — the
* same span `stepProgress` already runs. Composing `activeIndex` and
* `stepProgress` means it inherits their exact-mirror-on-reverse property
* and is monotonic non-increasing across steps at any scroll position.
*/
function chapterProgress(tops, ends, trigger) {
	const active = activeIndex(tops, trigger);
	return tops.map((top, i) => {
		var _ends$i;
		if (active < 0 || i > active) return 0;
		if (i < active) return 1;
		return stepProgress(top, (_ends$i = ends[i]) !== null && _ends$i !== void 0 ? _ends$i : top, trigger);
	});
}
var lerp = (a, b, t) => a + (b - a) * t;
/**
* Interpolate two shots along the van Wijk–Nuij smooth pan-zoom flight
* (§15.3), at the paper's default ρ = √2. The path is the geodesic of
* zoom-pan space, so a long pan pulls OUT through its middle and back in
* rather than sliding flat, and `t` maps linearly onto the path's arc
* parameter — constant perceived velocity, with the reader's scroll pace as
* the only easing there is (no duration, no easing knob; ρ is fixed in code).
*
* `worldWidth` is the stage's own width in the same untransformed camera
* units as `cx`/`cy`, pinning view width to `w ≡ worldWidth / k`. That pin is
* load-bearing: pan distance and view width have to be commensurable, and
* feeding the analytic form a normalized `1/k` against a world-unit pan is what
* produces absurd mid-flight zoom-outs. It carries a default only because
* every three-argument caller reaches a `worldWidth`-independent branch —
* identical shots, zero pan distance, or an exact endpoint — where no value
* of it can reach the result.
*/
function interpolateShot(from, to, t, worldWidth = 1) {
	if (t <= 0) return { ...from };
	if (t >= 1) return { ...to };
	const d = Math.hypot(to.cx - from.cx, to.cy - from.cy);
	if (d < 1e-6) return {
		cx: lerp(from.cx, to.cx, t),
		cy: lerp(from.cy, to.cy, t),
		k: from.k * (to.k / from.k) ** t
	};
	const w0 = worldWidth / from.k;
	const w1 = worldWidth / to.k;
	const dw = w1 * w1 - w0 * w0;
	const b0 = (dw + 4 * d * d) / (4 * w0 * d);
	const b1 = (dw - 4 * d * d) / (4 * w1 * d);
	const cosh0 = Math.hypot(b0, 1);
	const r = lerp(-Math.asinh(b0), -Math.asinh(b1), t);
	const u = (cosh0 * Math.tanh(r) + b0) * w0 / (2 * d);
	return {
		cx: lerp(from.cx, to.cx, u),
		cy: lerp(from.cy, to.cy, u),
		k: from.k * Math.cosh(r) / cosh0
	};
}
/**
* Default framing (§15.3): no `data-zoom` means "fit" — frame the target's
* box at `fraction` of the stage, whichever axis is tighter. Degenerate
* zero-size boxes guard with max(1, …) rather than dividing by zero.
*
* The fraction is a parameter because §16's named framings differ from the
* unnamed default in nothing else, and it keeps its historical 0.7 as the
* default so those two spellings of "fit" stay one number in one place: a
* caller that resolves a name (src/camera.ts) hands the fraction over, and a
* caller with nothing to say — including one whose name resolved to nothing —
* omits it and gets the default framing rather than `NaN`.
*/
function fitZoom(targetW, targetH, stageW, stageH, fraction = .7) {
	return fraction * Math.min(stageW / Math.max(1, targetW), stageH / Math.max(1, targetH));
}
/**
* Compose a shot into the CSS transform applied to `[data-camera]`: move the
* shot's target center to the stage's center, then scale around it. Values
* are in the camera element's own local units (SVG's `transform` interprets
* unitless `px` there as user units, so this composes correctly whether the
* camera element renders at 1:1 or is scaled by an ancestor viewBox).
*/
function cameraTransform(shot, stageCenter) {
	return `translate(${stageCenter.x}px, ${stageCenter.y}px) scale(${shot.k}) translate(${-shot.cx}px, ${-shot.cy}px)`;
}
var SPAN = /^([\w-]*)\.\.([\w-]*)$/;
/**
* §16.1 `data-show` range resolution: a token list and the story's step keys
* in DOM order (`stepId` — the real id, or the numeric-index fallback) in,
* the set of keys the element is shown for out, plus every token that
* resolved to nothing and why.
*
* Endpoints resolve by index in the passed order, so membership is fixed by
* the order it was handed — §5.1's live geometry keeps applying to positions
* only. Open endpoints mean the story's first and last step, so `..` is every
* step: distinct from omitting `data-show`, which opts out of visibility
* mechanics entirely and never reaches here.
*
* A reversed span (`recovery..crash`) contributes nothing and is reported —
* never quietly swapped into the forward span, because a swap would hide an
* author's misunderstanding of their own step order behind working output. A
* dangling endpoint and a malformed span share the `'no-step'` disposition
* because both are the same authoring mistake — a token naming a step the
* story doesn't have.
*
* The issue list is data, not prose: message wording and the warn channel
* belong to the caller (§15.6), which is what keeps this module console-free.
*/
function resolveShow(tokens, stepKeys) {
	const keys = /* @__PURE__ */ new Set();
	const issues = [];
	for (const token of tokens) {
		if (!token.includes("..")) {
			if (stepKeys.includes(token)) keys.add(token);
			else issues.push({
				token,
				reason: "no-step"
			});
			continue;
		}
		const span = SPAN.exec(token);
		if (!span) {
			issues.push({
				token,
				reason: "no-step"
			});
			continue;
		}
		const from = span[1] ? stepKeys.indexOf(span[1]) : 0;
		const to = span[2] ? stepKeys.indexOf(span[2]) : stepKeys.length - 1;
		if (from < 0 || to < 0) {
			issues.push({
				token,
				reason: "no-step"
			});
			continue;
		}
		if (from > to) {
			issues.push({
				token,
				reason: "reversed"
			});
			continue;
		}
		for (let i = from; i <= to; i++) keys.add(stepKeys[i]);
	}
	return {
		keys,
		issues
	};
}
//#endregion
//#region src/camera.ts
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
var warned = /* @__PURE__ */ new Set();
function warnOnce(message) {
	if (warned.has(message)) return;
	warned.add(message);
	console.warn(message);
}
/** `[data-camera]` opts in only when it can resolve shots (SVG content). */
function resolveRig(graphic) {
	var _graphic$querySelecto;
	const camera = (_graphic$querySelecto = graphic === null || graphic === void 0 ? void 0 : graphic.querySelector("[data-camera]")) !== null && _graphic$querySelecto !== void 0 ? _graphic$querySelecto : null;
	if (!camera || !graphic || !("getScreenCTM" in camera)) return null;
	return {
		camera,
		stage: graphic
	};
}
var boxOf = (p1, p2) => ({
	x: Math.min(p1.x, p2.x),
	y: Math.min(p1.y, p2.y),
	w: Math.abs(p2.x - p1.x),
	h: Math.abs(p2.y - p1.y)
});
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
function stageRect(rig) {
	const parent = rig.camera.parentNode;
	const ctm = parent && "getScreenCTM" in parent ? parent.getScreenCTM() : null;
	if (!ctm) return null;
	const inv = ctm.inverse();
	const r = rig.stage.getBoundingClientRect();
	return boxOf(new DOMPoint(r.left, r.top).matrixTransform(inv), new DOMPoint(r.right, r.bottom).matrixTransform(inv));
}
/**
* `target`'s box in the camera's own untransformed coordinate space.
* `target.getScreenCTM()` already includes whatever the camera's CURRENT
* transform is (target is its descendant); dividing it by the camera's own
* screen matrix cancels that transform out algebraically, so this is
* self-correcting mid-flight rather than needing to read `target`'s
* rendered box (which the camera's own live transform would distort).
*/
function targetRect(rig, target) {
	if (!("getBBox" in target && "getScreenCTM" in target)) return null;
	const el = target;
	const camCTM = rig.camera.getScreenCTM();
	const targetCTM = el.getScreenCTM();
	if (!camCTM || !targetCTM) return null;
	const toCamera = camCTM.inverse().multiply(targetCTM);
	const box = el.getBBox();
	return boxOf(new DOMPoint(box.x, box.y).matrixTransform(toCamera), new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(toCamera));
}
/**
* §16: disambiguate on the FIRST CHARACTER — a digit or `-` means raw
* coordinates, anything else is a selector. Dead simple on purpose, and that
* pins two traps: `".5 0 10 10"` and `"+50 0 200 100"` take the SELECTOR path
* (and fail soft as "matches no element"), because an author writes `0.5`, not
* `.5`. Sniffing further would buy those two values at the cost of the rule
* itself — an author could no longer tell which path a value takes by looking
* at its first character.
*/
function parseFocus(value) {
	var _value$;
	const first = (_value$ = value[0]) !== null && _value$ !== void 0 ? _value$ : "";
	if (first !== "-" && !(first >= "0" && first <= "9")) return {
		kind: "selector",
		selector: value
	};
	const parts = value.trim().split(/\s+/).map(Number);
	const [x, y, w, h] = parts;
	if (parts.length !== 4 || !parts.every(Number.isFinite) || w <= 0 || h <= 0) return {
		kind: "malformed",
		value
	};
	return {
		kind: "box",
		box: {
			x,
			y,
			w,
			h
		}
	};
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
function queryFocus(selector) {
	try {
		return document.querySelector(selector);
	} catch {
		return null;
	}
}
/**
* The subject box a `data-focus` frames, in the camera's own untransformed
* space. Null is the fail-soft disposition §15.3 pins for every value that
* resolves to no box — absent, malformed coordinates, or a selector matching
* nothing: warn once (§15.6) and let the caller hold.
*/
function focusBox(rig, el) {
	const value = el.dataset.focus;
	if (!value) return null;
	const spec = parseFocus(value);
	if (spec.kind === "box") return spec.box;
	if (spec.kind === "malformed") {
		warnOnce(`scrolly: data-focus="${value}" is not four finite numbers x y w h`);
		return null;
	}
	const target = queryFocus(spec.selector);
	if (!target) {
		warnOnce(`scrolly: data-focus="${value}" matches no element`);
		return null;
	}
	return targetRect(rig, target);
}
/**
* §16 `data-shot` names a FRAMING — the fraction of the stage the subject's
* box is fitted to — and never a timing. Mapping the name to that number is
* the whole of this module's part in it; geometry.ts's `fitZoom` owns the
* arithmetic the number feeds, so this stays a readable table of authoring
* policy with no fit math around it. `medium` is the unnamed default's own
* fraction, which is what makes `data-shot="medium"` and no attribute the
* same framing.
*
* A missing or unrecognized name reads as `undefined` and lands on `fitZoom`'s
* own default — the fallback framing has one home, in the module that owns
* fit, rather than a second copy of 0.7 here.
*/
var SHOT_FRACTIONS = {
	wide: .5,
	medium: .7,
	close: .9
};
/**
* The magnification `el` asks for — and §15.6's report of a framing that was
* authored in vain. Both diagnostics belong at this one fork because both say
* the same thing about the same mistake: the `data-shot` on this element
* changed nothing. An explicit `data-zoom` outranks the name outright; on the
* fit path a name outside the table lands on `fitZoom`'s own default, which is
* `medium`'s fraction. Neither warning moves a resolved value — the fallbacks
* they describe are the ones already in force.
*
* `warnOnce` keys on the whole message, so each offending value is reported
* exactly once (a resize re-measure re-runs this for every step) while two
* different bad names stay two distinct reports.
*/
function resolveZoom(el, box, stage) {
	var _el$dataset$zoom;
	const shot = el.dataset.shot;
	const zoom = Number.parseFloat((_el$dataset$zoom = el.dataset.zoom) !== null && _el$dataset$zoom !== void 0 ? _el$dataset$zoom : "");
	if (Number.isFinite(zoom)) {
		if (shot !== void 0) warnOnce(`scrolly: data-shot="${shot}" ignored — data-zoom="${el.dataset.zoom}" on the same element wins`);
		return zoom;
	}
	const fraction = SHOT_FRACTIONS[shot !== null && shot !== void 0 ? shot : ""];
	if (shot !== void 0 && fraction === void 0) warnOnce(`scrolly: data-shot="${shot}" is not a known shot name — using the medium fit`);
	return fitZoom(box.w, box.h, stage.w, stage.h, fraction);
}
/**
* Resolve every focused step's shot. A `data-focus` that resolves to no box —
* a selector matching nothing, or malformed coordinates — warns once and is
* treated as absent (hold, never a throw or a jump to identity — §15.3).
*/
function measureShots(rig, root, steps) {
	if (!root.hasAttribute("data-focus") && !steps.some((s) => s.hasAttribute("data-focus"))) warnOnce("scrolly: data-camera has no data-focus anywhere — the camera never moves");
	const stage = stageRect(rig);
	const resolve = (el) => {
		const box = focusBox(rig, el);
		if (!box || !stage) return null;
		return {
			cx: box.x + box.w / 2,
			cy: box.y + box.h / 2,
			k: resolveZoom(el, box, stage)
		};
	};
	const establishing = resolve(root);
	const own = steps.map(resolve);
	const held = [];
	const next = [];
	let arrived = establishing;
	own.forEach((shot, i) => {
		const from = shot !== null && shot !== void 0 ? shot : arrived;
		held.push(from);
		const later = own.slice(i + 1).find((s) => s !== null);
		const to = shot ? later !== null && later !== void 0 ? later : shot : from;
		next.push(to);
		arrived = to;
	});
	return {
		establishing,
		held,
		next,
		center: stage ? {
			x: stage.x + stage.w / 2,
			y: stage.y + stage.h / 2
		} : null,
		worldWidth: stage ? stage.w : null
	};
}
//#endregion
//#region src/events.ts
function emit(root, name, detail) {
	root.dispatchEvent(new CustomEvent(`scrolly:${name}`, {
		detail,
		bubbles: true
	}));
}
/** Listen on the story root; returns an unsubscribe function. */
function subscribe(root, name, fn) {
	const type = `scrolly:${name}`;
	const handler = (e) => fn(e.detail);
	root.addEventListener(type, handler);
	return () => root.removeEventListener(type, handler);
}
//#endregion
//#region src/keyboard.ts
function handleKeydown(e, host) {
	if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
	if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
	const t = e.target;
	if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
	const next = host.active + (e.key === "ArrowRight" ? 1 : -1);
	const step = host.steps[next];
	if (!step) return;
	e.preventDefault();
	const trigger = window.innerHeight * host.offset;
	const top = step.getBoundingClientRect().top + window.scrollY;
	const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	window.scrollTo({
		top: top - trigger + 2,
		behavior: reduce ? "auto" : "smooth"
	});
}
//#endregion
//#region src/motion.ts
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
var reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
var Motion = class {
	/**
	* `chapters` are the step ids the core exposes as `--progress-<id>` (§15.2)
	* — the only ids a `data-scrub` can bind to.
	*/
	constructor(root, graphic, steps, chapters) {
		this._scrubs = [];
		this._shots = null;
		this._transition = null;
		this._root = root;
		this._steps = steps;
		this._rig = resolveRig(graphic);
		this._stampScrubs(chapters);
		this.measure();
	}
	measure() {
		if (this._rig) this._shots = measureShots(this._rig, this._root, this._steps);
	}
	/** Per frame: the camera's transform for the position the core just measured. */
	update(active, step) {
		const shots = this._shots;
		if (!(shots === null || shots === void 0 ? void 0 : shots.center) || shots.worldWidth === null) return;
		const shot = this._cameraShot(active, step, shots.worldWidth);
		if (shot) this._root.style.setProperty("--camera-transform", cameraTransform(shot, shots.center));
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
	stepChange(write) {
		var _this$_transition;
		this.measure();
		if (this._root.dataset.morph === void 0 || reducedMotion() || typeof document.startViewTransition !== "function") {
			write();
			return;
		}
		(_this$_transition = this._transition) === null || _this$_transition === void 0 || _this$_transition.skipTransition();
		this._transition = document.startViewTransition(write);
	}
	destroy() {
		var _this$_transition2;
		(_this$_transition2 = this._transition) === null || _this$_transition2 === void 0 || _this$_transition2.skipTransition();
		for (const el of this._scrubs) el.style.removeProperty("--t");
		this._scrubs = [];
		this._root.style.removeProperty("--camera-transform");
		this._shots = null;
	}
	_cameraShot(active, step, worldWidth) {
		if (!this._shots) return null;
		if (active < 0) return this._shots.establishing;
		const from = this._shots.held[active];
		const to = this._shots.next[active];
		if (!from || !to) return null;
		return interpolateShot(from, to, reducedMotion() ? Math.round(step) : step, worldWidth);
	}
	_stampScrubs(chapters) {
		const bound = new Set(chapters);
		for (const el of this._root.querySelectorAll("[data-scrub]")) {
			const id = el.dataset.scrub;
			if (!id) el.style.setProperty("--t", "var(--story-progress)");
			else if (bound.has(id)) el.style.setProperty("--t", `var(--progress-${id})`);
			else {
				warnOnce(`scrolly: data-scrub="${id}" matches no chapter`);
				continue;
			}
			this._scrubs.push(el);
		}
	}
};
//#endregion
//#region src/story.ts
/**
* The Story runtime — one instance per `.scrolly` element. Owns the
* IntersectionObserver-gated scroll loop and every §5–§7 DOM state write; the
* math it acts on lives in geometry.ts, the plumbing in events.ts/keyboard.ts,
* and the §15 motion writes (scrub stamps, camera, morph) in motion.ts.
*/
var OFFSET = .5;
var stepId = (el, i) => el.id || String(i);
var VALID_IDENT = /^[A-Za-z0-9_-]+$/;
var instances = /* @__PURE__ */ new WeakMap();
/** `Scrolly.init()` is idempotent per element: re-init returns the existing Story. */
function getOrCreateStory(el, opts) {
	var _instances$get;
	return (_instances$get = instances.get(el)) !== null && _instances$get !== void 0 ? _instances$get : new Story(el, opts);
}
var Story = class {
	constructor(root, opts = {}) {
		var _root$dataset$offset, _opts$offset;
		this.active = -1;
		this._engaged = false;
		this._ticking = false;
		this._subs = [];
		this._destroyed = false;
		this.root = root;
		this.offset = parseFloat((_root$dataset$offset = root.dataset.offset) !== null && _root$dataset$offset !== void 0 ? _root$dataset$offset : String((_opts$offset = opts.offset) !== null && _opts$offset !== void 0 ? _opts$offset : OFFSET));
		this.graphic = root.querySelector(":scope > figure");
		this.steps = [...root.querySelectorAll(":scope > .step")];
		this.shown = this._resolveShows();
		this._progressIds = this.steps.map((s, index) => ({
			id: s.id,
			index
		})).filter(({ id }) => VALID_IDENT.test(id));
		this._onScroll = () => this._tick();
		this._onResize = () => {
			this._motion.measure();
			this._tick();
		};
		this._onKey = (e) => handleKeydown(e, this);
		instances.set(root, this);
		this._io = new IntersectionObserver((entries) => {
			this._engage(entries.some((e) => e.isIntersecting));
		}, { rootMargin: "100px 0px" });
		this._io.observe(root);
		for (const s of this.steps) s.classList.add("is-future");
		this._motion = new Motion(root, this.graphic, this.steps, this._progressIds.map(({ id }) => id));
		root.classList.add("is-ready");
		this._update();
	}
	_engage(on) {
		if (on === this._engaged) return;
		this._engaged = on;
		const fn = on ? "addEventListener" : "removeEventListener";
		window[fn]("scroll", this._onScroll, { passive: true });
		window[fn]("resize", this._onResize);
		window[fn]("keydown", this._onKey);
		if (on) this._update();
	}
	_tick() {
		if (this._ticking) return;
		this._ticking = true;
		requestAnimationFrame(() => {
			this._ticking = false;
			this._update();
		});
	}
	_update() {
		const first = this.steps[0];
		const last = this.steps[this.steps.length - 1];
		if (!first || !last) return;
		const trigger = window.innerHeight * this.offset;
		const tops = this.steps.map((s) => s.getBoundingClientRect().top);
		const active = activeIndex(tops, trigger);
		if (active !== this.active) this._activate(active);
		const lastBottom = last.getBoundingClientRect().bottom;
		const story = storyProgress(first.getBoundingClientRect().top, lastBottom, trigger);
		let step = 0;
		const current = this.steps[active];
		if (current) {
			const r = current.getBoundingClientRect();
			const next = this.steps[active + 1];
			const end = next ? next.getBoundingClientRect().top : r.bottom;
			step = stepProgress(r.top, end, trigger);
		}
		this.root.style.setProperty("--story-progress", story.toFixed(4));
		this.root.style.setProperty("--step-progress", step.toFixed(4));
		if (this._progressIds.length > 0) {
			const chapters = chapterProgress(tops, [...tops.slice(1), lastBottom], trigger);
			for (const { id, index } of this._progressIds) {
				var _chapters$index;
				this.root.style.setProperty(`--progress-${id}`, ((_chapters$index = chapters[index]) !== null && _chapters$index !== void 0 ? _chapters$index : 0).toFixed(4));
			}
		}
		this._motion.update(active, step);
		if (active >= 0) emit(this.root, "progress", {
			...this._detail(active),
			progress: step,
			storyProgress: story
		});
	}
	_activate(next) {
		const prev = this.active;
		const direction = next > prev ? "down" : "up";
		this.active = next;
		const write = () => {
			if (this._destroyed) return;
			this.steps.forEach((s, i) => {
				s.classList.toggle("is-past", next > -1 && i < next);
				s.classList.toggle("is-active", i === next);
				s.classList.toggle("is-future", next < 0 || i > next);
			});
			const activeStep = this.steps[next];
			const id = activeStep ? stepId(activeStep, next) : null;
			if (id === null) this.root.removeAttribute("data-active-step");
			else this.root.setAttribute("data-active-step", id);
			for (const { el, keys } of this.shown) el.classList.toggle("is-shown", id !== null && keys.has(id));
		};
		this._motion.stepChange(write);
		if (prev >= 0) emit(this.root, "stepexit", {
			...this._detail(prev),
			direction
		});
		if (next >= 0) emit(this.root, "stepenter", {
			...this._detail(next),
			direction
		});
	}
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
	_resolveShows() {
		const stepKeys = this.steps.map(stepId);
		return (this.graphic ? [...this.graphic.querySelectorAll("[data-show]")] : []).map((el) => {
			var _el$dataset$show;
			const { keys, issues } = resolveShow(((_el$dataset$show = el.dataset.show) !== null && _el$dataset$show !== void 0 ? _el$dataset$show : "").split(/\s+/).filter(Boolean), stepKeys);
			for (const { token, reason } of issues) warnOnce(reason === "reversed" ? `scrolly: data-show="${token}" is a reversed range` : `scrolly: data-show="${token}" matches no step id`);
			return {
				el,
				keys
			};
		});
	}
	_detail(i) {
		const step = this.steps[i];
		return {
			step,
			id: stepId(step, i),
			index: i
		};
	}
	on(name, fn) {
		const unsubscribe = subscribe(this.root, name, fn);
		const off = () => {
			unsubscribe();
			const i = this._subs.indexOf(off);
			if (i !== -1) this._subs.splice(i, 1);
		};
		this._subs.push(off);
		return off;
	}
	destroy() {
		this._destroyed = true;
		this._motion.destroy();
		this._io.disconnect();
		this._engage(false);
		for (const off of [...this._subs]) off();
		this._subs = [];
		for (const s of this.steps) s.classList.remove("is-past", "is-active", "is-future");
		for (const { el } of this.shown) el.classList.remove("is-shown");
		this.root.classList.remove("is-ready");
		this.root.removeAttribute("data-active-step");
		this.root.style.removeProperty("--step-progress");
		this.root.style.removeProperty("--story-progress");
		for (const { id } of this._progressIds) this.root.style.removeProperty(`--progress-${id}`);
		instances.delete(this.root);
	}
};
//#endregion
//#region src/index.ts
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
function init(target, opts) {
	if (target === void 0) return [...document.querySelectorAll(".scrolly")].map((el) => getOrCreateStory(el));
	const el = typeof target === "string" ? document.querySelector(target) : target;
	if (!el) throw new Error(`scrolly: no element matches ${target}`);
	return getOrCreateStory(el, opts);
}
var Scrolly = {
	version: "0.0.1",
	init
};
//#endregion
export { Scrolly as default };
