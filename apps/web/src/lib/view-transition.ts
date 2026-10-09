/**
 * Page transitions through the View Transitions API: a detail page slides in
 * from the right and Back slides it out, tab switches cross-fade. The look is
 * in motion.css under `:root[data-nav]`.
 */
export type NavKind = "forward" | "back" | "tab";

const TITLE_NAME = "vt-title";
const SETTLE_TIMEOUT_MS = 500;

/** Transitions run only with the motion setting on, motion not reduced, and the API there. */
export function transitionsOn(input: { motion: string | undefined; reducedMotion: boolean; supported: boolean }): boolean {
  return input.supported && input.motion === "reactive" && !input.reducedMotion;
}

/** A plain left click that a link would follow in this window. */
export function isPlainClick(e: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented">): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

type StartViewTransition = (update: () => Promise<void>) => { finished: Promise<void> };

function startFn(): StartViewTransition | null {
  if (typeof document === "undefined") return null;
  const fn = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition;
  return typeof fn === "function" ? fn.bind(document) : null;
}

export function canTransition(): boolean {
  if (typeof document === "undefined") return false;
  return transitionsOn({
    motion: document.documentElement.dataset.motion,
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    supported: startFn() !== null,
  });
}

/** The card title under the last press, so it can morph into the detail page's title. */
let lastPressTitle: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    (e) => {
      const card = (e.target as Element | null)?.closest?.(".entity-card");
      lastPressTitle = card?.querySelector<HTMLElement>(".entity-card-title") ?? null;
    },
    true,
  );
}

/**
 * Resolves once the URL has moved and the page has changed under it, so the
 * new snapshot is the new page; `router.back()` moves the URL before React renders.
 */
function routeSettled(before: string): Promise<void> {
  return new Promise((resolve) => {
    let mutated = false;
    const observer = new MutationObserver(() => { mutated = true; });
    observer.observe(document.body, { childList: true, subtree: true });
    const started = performance.now();
    const tick = () => {
      if ((location.href !== before && mutated) || performance.now() - started > SETTLE_TIMEOUT_MS) {
        observer.disconnect();
        requestAnimationFrame(() => resolve());
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Runs a navigation inside a view transition, or straight away when transitions are off. */
export function navTransition(kind: NavKind, navigate: () => void): void {
  const start = startFn();
  if (!start || !canTransition()) {
    navigate();
    return;
  }
  const root = document.documentElement;
  const title = kind === "forward" && lastPressTitle?.isConnected ? lastPressTitle : null;
  if (title) title.style.viewTransitionName = TITLE_NAME;
  root.dataset.nav = kind;
  const before = location.href;
  const transition = start(async () => {
    // The old snapshot is taken: the new page's title takes the name.
    if (title) title.style.viewTransitionName = "";
    navigate();
    await routeSettled(before);
  });
  void transition.finished.finally(() => {
    if (root.dataset.nav === kind) delete root.dataset.nav;
  });
}
