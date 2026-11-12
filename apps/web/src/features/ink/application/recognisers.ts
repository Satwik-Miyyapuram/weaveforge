/**
 * The engines the web app can offer, each behind core's `InkRecogniser` (§5.2).
 *
 * One of them: **Windows Ink**, through the desktop bridge. Offline, ships with
 * the OS, and the one an engine comparison on this machine actually won. It
 * exists only where `window.weaveforge` does and says so from `available()` — so
 * in a browser there is honestly no engine, and the Recognise control is
 * disabled rather than pretending.
 *
 * Two used to sit below it and neither was real. **MyScript iink** was a cloud
 * recogniser that joined the list when a key was pasted into Settings: the only
 * engine that sent strokes off the machine, behind a field for a service this app
 * does not support. **The in-worker stroke model** (`stroke-ctc-small@1`) shipped
 * no weights and returned `available() → false` unconditionally, existing only so
 * a settings row could be greyed out — which is what the reader saw as "Built-in
 * stroke model — unavailable. Not shipped in this build" and reasonably asked
 * why it was in their settings at all.
 */

import {
  type InkRecogniser,
  type RecognisedLine,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

import type {
  DesktopBridge,
  DesktopInkRequest,
} from "@/lib/desktop/desktop-bridge";

type InkRequestInput = Parameters<ReturnType<typeof readyCore>["buildInkRequest"]>[0];

export const WINDOWS_INK_ENGINE_ID = "windows-ink@1";

/** How long a "not available" answer stands before the shell is asked again. */
export const INK_REPROBE_MS = 30_000;

/**
 * Windows Ink, reached over the bridge. `null` bridge means a browser.
 * A yes is kept; a no is asked again after INK_REPROBE_MS, so turning
 * handwriting on in Windows works without a restart.
 */
export function createDesktopInkRecogniser(
  bridge: () => DesktopBridge | null,
  now: () => number = Date.now,
): InkRecogniser {
  let known = false;
  let saidNoAt: number | null = null;
  return {
    id: WINDOWS_INK_ENGINE_ID,
    offline: true,
    online: true,
    async available() {
      if (known) return true;
      if (saidNoAt !== null && now() - saidNoAt < INK_REPROBE_MS) return false;
      const desktop = bridge();
      if (!desktop || typeof desktop.inkAvailable !== "function") return false;
      try {
        known = await desktop.inkAvailable();
        saidNoAt = known ? null : now();
        return known;
      } catch {
        // Often the bridge is not ready yet: answer no now, ask again later.
        return false;
      }
    },
    async recognise(lines, hints): Promise<RecognisedLine[]> {
      const desktop = bridge();
      if (!desktop)
        throw new Error(
          "The handwriting recogniser is only available on the desktop.",
        );
      // Rust builds the request and scores each helper line (`helper_line`):
      // per-word readings decide a line's text and score, and a line without
      // them is capped under certainty, since `1` is a person's correction.
      const result = await desktop.inkRecognise(
        readyCore().buildInkRequest({
          // Rust reads the lines only; the readonly arrays are safe to hand over.
          lines: lines as unknown as InkRequestInput["lines"],
          vocabulary: hints.vocabulary,
          lang: hints.lang,
        }) as DesktopInkRequest,
      );
      return result.lines.map((line) =>
        readyCore().inkLineFromHelper(line, hints.vocabulary),
      );
    },
  };
}

/**
 * The candidate list the selector is handed, in one place.
 *
 * One candidate. `createStrokeModelRecogniser` used to be the second — an engine
 * whose `available()` returned a hard-coded `false` and whose `recognise()`
 * threw "not shipped in this build". It existed only so the settings panel could
 * show a greyed-out row, which is not a reason to keep a stub engine in the
 * selection path: the selector had to probe it on every run to be told what the
 * source already said.
 *
 * No second argument any more either: the only candidate left needs no
 * configuration, which is the point. A recogniser that had to be switched on is
 * a recogniser that could be absent — and the bar's "no engine" state is honest
 * about that rather than being a thing the user could have fixed with a key.
 */
export function inkRecogniserCandidates(input: {
  bridge: () => DesktopBridge | null;
}): InkRecogniser[] {
  return [createDesktopInkRecogniser(input.bridge)];
}
