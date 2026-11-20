/**
 * Element rects for the pen path, read once and kept until something can move
 * them (perf review I3-I5). The pen projects every coalesced sample, checks
 * the sheet's edge per move and sizes the trail per update; each
 * `getBoundingClientRect` there, between style writes, forced a layout.
 *
 * A rect is dropped on any pointerdown, pointerup or pointercancel (so each
 * stroke starts from a fresh read), any scroll (capture phase, so every
 * scroller counts), a window resize, and the element itself resizing.
 */
export interface RectCache {
  rect(el: Element): DOMRect;
}

export function createRectCache(
  target: EventTarget | null,
  Observer: typeof ResizeObserver | undefined,
): RectCache {
  if (!target) return { rect: (el) => el.getBoundingClientRect() };
  let rects = new WeakMap<Element, DOMRect>();
  const observed = new WeakSet<Element>();
  const drop = () => {
    rects = new WeakMap();
  };
  const observer = Observer ? new Observer(drop) : null;
  for (const type of ["pointerdown", "pointerup", "pointercancel", "scroll", "resize"]) {
    target.addEventListener(type, drop, { capture: true, passive: true });
  }
  return {
    rect(el) {
      let rect = rects.get(el);
      if (!rect) {
        rect = el.getBoundingClientRect();
        rects.set(el, rect);
        if (observer && !observed.has(el)) {
          observed.add(el);
          observer.observe(el);
        }
      }
      return rect;
    },
  };
}

let shared: RectCache | null = null;

/** The app's cache, on the window; made on first use. */
export function cachedRect(el: Element): DOMRect {
  shared ??= createRectCache(
    typeof window === "undefined" ? null : window,
    typeof ResizeObserver === "undefined" ? undefined : ResizeObserver,
  );
  return shared.rect(el);
}
