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
  decodeInkWords,
  INK_ENGINE_MAX_CONFIDENCE,
  mapInkConfidence,
  type InkLine,
  type InkRecogniser,
  type InkRecognitionHints,
  type RecognisedLine,
} from "@weaveforge/core";

import type {
  DesktopBridge,
  DesktopInkRequest,
} from "@/lib/desktop/desktop-bridge";

export const WINDOWS_INK_ENGINE_ID = "windows-ink@1";

/** A page's lines as the desktop helper wants them: flat `[x, y, p, …]` per stroke. */
export function desktopInkRequest(
  lines: readonly InkLine[],
  hints: InkRecognitionHints,
): DesktopInkRequest {
  return {
    lines: lines.map((line) => ({
      strokes: line.strokes.map((stroke) => {
        const flat: number[] = [];
        for (let i = 0; i + 1 < stroke.points.length; i += 2) {
          flat.push(
            stroke.points[i]!,
            stroke.points[i + 1]!,
            stroke.pressures[i / 2] ?? 128,
          );
        }
        return flat;
      }),
    })),
    vocabulary: [...hints.vocabulary],
    lang: hints.lang,
  };
}

/** Windows Ink, reached over the bridge. `null` bridge means a browser. */
export function createDesktopInkRecogniser(
  bridge: () => DesktopBridge | null,
): InkRecogniser {
  let known: boolean | null = null;
  return {
    id: WINDOWS_INK_ENGINE_ID,
    offline: true,
    online: true,
    async available() {
      if (known !== null) return known;
      const desktop = bridge();
      if (!desktop || typeof desktop.inkAvailable !== "function") return false;
      try {
        known = await desktop.inkAvailable();
      } catch {
        known = false;
      }
      return known;
    },
    async recognise(lines, hints): Promise<RecognisedLine[]> {
      const desktop = bridge();
      if (!desktop)
        throw new Error(
          "The handwriting recogniser is only available on the desktop.",
        );
      const result = await desktop.inkRecognise(
        desktopInkRequest(lines, hints),
      );
      return result.lines.map((line) => {
        // The helper's `confidence` is only "produced text or not"; its
        // per-word readings are the evidence, and the decoder turns them into
        // a choice and a score. A line with no words is empty or came from a
        // helper that predates them, and is capped the same way either way:
        // `1` is a person's correction, never an engine's.
        if (line.text && line.words?.length) {
          return decodeInkWords(line.words, hints.vocabulary, line.text);
        }
        return {
          text: line.text,
          conf: Math.min(
            mapInkConfidence(line.confidence),
            INK_ENGINE_MAX_CONFIDENCE,
          ),
          ...(line.alternatives?.length
            ? { alternatives: [...line.alternatives] }
            : {}),
        };
      });
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
