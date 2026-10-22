/** Page transitions through the View Transitions API: a crossfade (motion.css under :root[data-nav]), off when reduced or unsupported. */
export type NavKind = "forward" | "back" | "tab";

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

/**
 * Resolves once the URL has moved and the page has changed under it, so the
 * new snapshot is the new page; `router.back()` moves the URL before React renders.
 */
function routeSettled(before: string): Promise<void> {
  return new Promise((resolve) => {
    let mutated = false;
    let settled = false;
    let checkTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const done = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      if (fallbackTimer !== null) clearTimeout(fallbackTimer);
      if (checkTimer !== null) clearTimeout(checkTimer);
      resolve();
    };

    // Timers, not frames: the browser pauses rendering inside the update.
    fallbackTimer = setTimeout(done, SETTLE_TIMEOUT_MS);

    const check = () => {
      checkTimer = null;
      if (settled) return;
      if (mutated && location.href !== before) {
        done();
      } else {
        checkTimer = setTimeout(check, 0);
      }
    };

    const observer = new MutationObserver(() => {
      mutated = true;
      if (location.href !== before) {
        done();
      } else if (checkTimer === null) {
        checkTimer = setTimeout(check, 0);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
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
  root.dataset.nav = kind;
  const before = location.href;
  const transition = start(async () => {
    navigate();
    await routeSettled(before);
  });
  void transition.finished.finally(() => {
    if (root.dataset.nav !== kind) return;
    // The crossfade already showed the page: clearing data-nav must not replay page-in.
    document.querySelectorAll(".page-transition").forEach((el) => el.classList.add("page-transition--vt"));
    delete root.dataset.nav;
  });
}
