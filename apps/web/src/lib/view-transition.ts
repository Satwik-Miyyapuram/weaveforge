/** Page transitions through the View Transitions API, in three tiers (calm, reactive, CRT); the look is in motion.css under :root[data-nav]. */
export type NavKind = "forward" | "back" | "tab";

const TITLE_NAME = "vt-title";
const SETTLE_TIMEOUT_MS = 500;

export type MotionTier = "off" | "calm" | "reactive" | "crt";
type TierInput = { motion: string | undefined; theme: string | undefined; reducedMotion: boolean; supported: boolean };

/** Calm by default, bigger with Reactive motion, stepped on CRT; off when reduced or unsupported. */
export function motionTier(input: TierInput): MotionTier {
  if (!input.supported || input.reducedMotion) return "off";
  if (input.theme === "crt") return "crt";
  return input.motion === "reactive" ? "reactive" : "calm";
}

export function transitionsOn(input: TierInput): boolean {
  return motionTier(input) !== "off";
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

function currentTier(): MotionTier {
  if (typeof document === "undefined") return "off";
  const root = document.documentElement;
  return motionTier({
    motion: root.dataset.motion,
    theme: root.dataset.theme,
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    supported: startFn() !== null,
  });
}

export function canTransition(): boolean {
  return currentTier() !== "off";
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
  const tier = currentTier();
  if (!start || tier === "off") {
    navigate();
    return;
  }
  const root = document.documentElement;
  // Only the reactive tier morphs the card title into the page title.
  const title = kind === "forward" && tier === "reactive" && lastPressTitle?.isConnected ? lastPressTitle : null;
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
