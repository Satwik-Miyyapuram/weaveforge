/**
 * The words this engine's callers see: ids, MIME types, defaults, the options
 * type and the gate.
 *
 * Split out of the old single file (see `./index.ts` for the whole engine's
 * story) because the vocabulary is what a *caller* — the selector in
 * `../recognise.ts`, the settings screen, a note's `ink-engine` field — reads,
 * while the request, the response and the engine are what the *call* reads.
 * The three privacy rules in the banner live on the pieces they are rules
 * about: the gate here, the throw-not-fallback in `./engine.ts`.
 */
import type { InkLine, InkRecognitionHints, RecognisedLine } from "../recognise.js";

/** The id written into a note's `ink-engine` (§5.2).
 *
 * Declared and exported as well as used below so a caller can compare against it:
 * the note-records-the-engine rule is only useful if the string in the file and
 * the string in the selector agree.
 */
export const MYSCRIPT_ENGINE_ID = "myscript@1";

/** The iink server iinkTS itself defaults to; overridable for a self-hosted one. */
export const MYSCRIPT_DEFAULT_HOST = "cloud.myscript.com";

/** The one URL the batch client posts to, text and maths alike. */
export const MYSCRIPT_ENDPOINT_PATH = "/api/v4.0/iink/recognize";

/** JIIX: the element tree that text recognition comes back as. */
export const MYSCRIPT_JIIX_MIME = "application/vnd.myscript.jiix";

/** LaTeX: what a maths conversion returns, as a bare string. */
export const MYSCRIPT_LATEX_MIME = "application/x-latex";

/**
 * The `contentType` switch that makes one URL two "endpoints".
 *
 * `Text` is handwriting-to-text; `Math` is handwriting-to-LaTeX and is what
 * {@link convertToLatex} asks for. They are not two hosts or two paths — the
 * plan's wording ("maths → LaTeX … documented as a separate endpoint/parameter")
 * is this parameter.
 */
export const MYSCRIPT_CONTENT_TYPES = { text: "Text", math: "Math" } as const;

/** One of the two recognition types the endpoint switches on. */
export type MyScriptContentType =
  (typeof MYSCRIPT_CONTENT_TYPES)[keyof typeof MYSCRIPT_CONTENT_TYPES];

/**
 * The confidence every line from this engine carries.
 *
 * JIIX has no per-line score, and inventing one would make §5.4's dotted underline
 * claim to know which lines are doubtful. `0.9` is above `INK_UNSURE_CONFIDENCE`,
 * so a mapped page does not render entirely dotted; it is a property of the
 * format, not a measurement of the hand.
 */
export const MYSCRIPT_DEFAULT_CONFIDENCE = 0.9;

/**
 * What one unit of our coordinates is worth to the service, in millimetres.
 *
 * iinkTS sends `0.265` by default, which is a millimetre-per-unit ratio for a
 * canvas measured in CSS pixels. Ink note coordinates are tenths of a millimetre
 * (§4.4), so one unit is `0.1` mm and the honest value is `0.1`. It is an option
 * as well as a constant because the server only needs the two axes to agree with
 * each other, and a caller that disagrees can say so. It is **not** used to place a
 * response: the mapping compares an element's position with a line's as fractions
 * of one page extent, so an answer in other units still maps.
 */
export const MYSCRIPT_DEFAULT_SCALE = 0.1;

/** How long a batch call may take before the caller is told the service is stuck. */
export const MYSCRIPT_DEFAULT_TIMEOUT_MS = 20_000;

/** The shape this module needs from `fetch`, and nothing more. */
export type MyScriptFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/**
 * The key and server a caller opted into.
 *
 * There is no default key and no other source for one: this type with no
 * `applicationKey` is the off position, and {@link isMyScriptConfigured} is what
 * turns "off" into a boolean a selector can read. `fetch` is injected rather than
 * read from a global for the same reason — the gate must not be openable by
 * anything ambient.
 */
export interface MyScriptOptions {
  /** The MyScript application key. Absent, empty or whitespace means off. */
  applicationKey?: string | null;
  /** `https` unless a self-hosted iink says otherwise. */
  scheme?: string;
  /** Host, defaulting to {@link MYSCRIPT_DEFAULT_HOST}. */
  host?: string;
  /** Injected for tests and for a runtime whose `fetch` is not on `globalThis`. */
  fetch?: MyScriptFetch;
  /** A batch call's budget, defaulting to {@link MYSCRIPT_DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** The scale sent to the server, defaulting to {@link MYSCRIPT_DEFAULT_SCALE}. */
  scale?: number;
}

/**
 * Whether a key was actually supplied.
 *
 * A blank string is not a key, so this trims before it decides. Nothing else is
 * consulted, which is the whole reason {@link MyScriptOptions} has no environment
 * or storage field: opting in is an argument, and only an argument.
 */
export function isMyScriptConfigured(options: MyScriptOptions = {}): boolean {
  const key = options.applicationKey;
  return typeof key === "string" && key.trim().length > 0;
}

/** The shared engine interface this one extends, for the index's re-exports. */
export type { InkLine, InkRecognitionHints, RecognisedLine };
