/**
 * The engines the web app can offer, each behind core's `InkRecogniser` (§5.2).
 *
 * Three of them, in the order the selector prefers:
 *
 * - **Windows Ink**, through the desktop bridge. Offline, ships with the OS, and
 *   the one an engine comparison on this machine actually won. It exists only
 *   where `window.weaveforge` does and says so from `available()`.
 * - **The in-worker stroke model** (`stroke-ctc-small@1`). This build ships no
 *   weights: §5.5 asks for the model's accuracy to be measured before it is
 *   relied on, and that measurement has not been made. So it answers
 *   `available() → false` honestly rather than pretending, and the selector
 *   moves on. The id is reserved so a note recognised by a later build says so.
 * - **MyScript**, opt-in and online. Constructed only when the caller has a
 *   key, which is the whole privacy line: without one it is not in the list.
 */

import {
  createMyScriptRecogniser,
  isMyScriptConfigured,
  mapInkConfidence,
  type InkLine,
  type InkRecogniser,
  type InkRecognitionHints,
  type MyScriptOptions,
  type RecognisedLine,
} from "@weaveforge/core";

import type { DesktopBridge, DesktopInkRequest } from "@/lib/desktop/desktop-bridge";

export const WINDOWS_INK_ENGINE_ID = "windows-ink@1";
export const STROKE_CTC_ENGINE_ID = "stroke-ctc-small@1";

/** A page's lines as the desktop helper wants them: flat `[x, y, p, …]` per stroke. */
export function desktopInkRequest(lines: readonly InkLine[], hints: InkRecognitionHints): DesktopInkRequest {
  return {
    lines: lines.map((line) => ({
      strokes: line.strokes.map((stroke) => {
        const flat: number[] = [];
        for (let i = 0; i + 1 < stroke.points.length; i += 2) {
          flat.push(stroke.points[i]!, stroke.points[i + 1]!, stroke.pressures[i / 2] ?? 128);
        }
        return flat;
      }),
    })),
    vocabulary: [...hints.vocabulary],
    lang: hints.lang,
  };
}

/** Windows Ink, reached over the bridge. `null` bridge means a browser. */
export function createDesktopInkRecogniser(bridge: () => DesktopBridge | null): InkRecogniser {
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
      if (!desktop) throw new Error("The handwriting recogniser is only available on the desktop.");
      const result = await desktop.inkRecognise(desktopInkRequest(lines, hints));
      return result.lines.map((line) => ({
        text: line.text,
        conf: mapInkConfidence(line.confidence),
        ...(line.alternatives?.length ? { alternatives: [...line.alternatives] } : {}),
      }));
    },
  };
}

/**
 * The in-worker stroke model, as this build has it: not yet.
 *
 * Kept as an engine rather than dropped from the list so the order in the
 * settings panel matches §5.2 and the "why is this greyed out" line can be
 * honest: the weights are not shipped until §5.5's measurement is made.
 */
export function createStrokeModelRecogniser(): InkRecogniser {
  return {
    id: STROKE_CTC_ENGINE_ID,
    offline: true,
    online: true,
    async available() {
      return false;
    },
    async recognise() {
      throw new Error("The stroke model is not shipped in this build.");
    },
  };
}

/** MyScript, when and only when a key was supplied. */
export function createOptionalMyScriptRecogniser(options: MyScriptOptions): InkRecogniser | null {
  if (!isMyScriptConfigured(options)) return null;
  return createMyScriptRecogniser(options);
}

/** The candidate list the selector is handed, in one place. */
export function inkRecogniserCandidates(input: {
  bridge: () => DesktopBridge | null;
  myScript?: MyScriptOptions;
}): InkRecogniser[] {
  const candidates: InkRecogniser[] = [
    createDesktopInkRecogniser(input.bridge),
    createStrokeModelRecogniser(),
  ];
  const myScript = input.myScript ? createOptionalMyScriptRecogniser(input.myScript) : null;
  if (myScript) candidates.push(myScript);
  return candidates;
}
