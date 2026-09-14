/**
 * The engine itself: the recogniser the selector in `../recognise.ts` may pick,
 * and the maths conversion a caller asks for on demand.
 *
 * Split from the vocabulary (see `./index.ts` for the whole story) because the
 * rules about *when this runs* are rules about the call, not the words: the gate
 * is a pure key check in `./vocabulary.ts`, and the throw-not-fallback lives here
 * where the call is refused.
 */
import type { InkLine, InkRecognitionHints, InkRecogniser, RecognisedLine } from "../recognise.js";
import {
  MYSCRIPT_CONTENT_TYPES,
  MYSCRIPT_DEFAULT_HOST,
  MYSCRIPT_DEFAULT_TIMEOUT_MS,
  MYSCRIPT_ENGINE_ID,
  MYSCRIPT_ENDPOINT_PATH,
  isMyScriptConfigured,
} from "./vocabulary.js";
import type { MyScriptFetch, MyScriptOptions } from "./vocabulary.js";
import { myScriptRequestBody } from "./request.js";
import type { MyScriptRequest } from "./request.js";
import { myScriptRecognisedLines } from "./response.js";
import type { MyScriptExportResponse } from "./response.js";
import { latexBlock, myScriptLatex } from "./latex.js";
import type { MyScriptLatex } from "./latex.js";

/** The engine, plus the maths conversion that is not part of the shared interface. */
export interface MyScriptRecogniser extends InkRecogniser {
  /**
   * Maths → LaTeX through the same endpoint, with the maths `contentType`.
   *
   * Not on {@link InkRecogniser} because it is the one engine-specific capability
   * in §5.2's row for this engine, and putting it on the shared interface would
   * make every offline engine answer a question it cannot.
   */
  convertMaths(request: MyScriptRequest): Promise<MyScriptLatex>;
}

/**
 * Build the engine.
 *
 * `available()` is a pure gate — a key was supplied or it was not — and makes no
 * network call, so the selector in `recognise.ts` can ask every engine in
 * preference order without a MyScript round trip for a user who never opted in.
 * The first *real* call is the one that leaves the machine, which is the moment
 * §5.2's "one dialog that says so, once" is about.
 *
 * `recognise()` throws when there is no key rather than resolving to empty lines.
 * An engine that answered "nothing recognised" without a key would be worse than
 * useless: the text layer would be rewritten with blanks and the note would record
 * an engine that never ran.
 */
export function createMyScriptRecogniser(options: MyScriptOptions = {}): MyScriptRecogniser {
  const timeoutMs = options.timeoutMs ?? MYSCRIPT_DEFAULT_TIMEOUT_MS;

  /** The URL the batch body is posted to; scheme and host both come from options. */
  const url = `${options.scheme ?? "https"}://${options.host ?? MYSCRIPT_DEFAULT_HOST}${MYSCRIPT_ENDPOINT_PATH}`;

  /**
   * Send one batch body and decode the answer.
   *
   * The key travels as a header, never in the body, which is what keeps it out of
   * any log that records a request payload — iinkTS' own client posts it the same
   * way, in `post()`. The answer is read as text first so a non-JSON error page
   * becomes the error message rather than a JSON parse failure.
   */
  const post = async (request: MyScriptRequest): Promise<MyScriptExportResponse> => {
    const key = options.applicationKey;
    if (!isMyScriptConfigured(options)) {
      throw new Error("MyScript is not available: no application key was supplied (§5.2).");
    }
    const send = options.fetch ?? (globalThis.fetch as unknown as MyScriptFetch | undefined);
    if (typeof send !== "function") {
      throw new Error("MyScript needs a fetch implementation, and this runtime has none.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await send(url, {
        method: "POST",
        headers: {
          applicationKey: (key as string).trim(),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(
          `MyScript answered ${response.status}: ${text.slice(0, 200) || "no detail"}`,
        );
      }
      try {
        return JSON.parse(text) as MyScriptExportResponse;
      } catch {
        throw new Error("MyScript answered with something that is not JSON.");
      }
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    id: MYSCRIPT_ENGINE_ID,
    // The two facts the selector and the note read: this engine is not offline and
    // it is an online (trajectory) engine, which is the distinction §5.1 calls
    // load-bearing.
    offline: false,
    online: true,

    async available(): Promise<boolean> {
      // A gate, not a probe: no key, no engine, and no packet.
      return isMyScriptConfigured(options);
    },

    async recognise(
      lines: InkLine[],
      hints: InkRecognitionHints,
    ): Promise<RecognisedLine[]> {
      const request = myScriptRequestBody(lines, hints, {
        contentType: MYSCRIPT_CONTENT_TYPES.text,
        ...(options.scale === undefined ? {} : { scale: options.scale }),
      });
      const response = await post(request);
      // The request's line table goes in with the response: it is what places an
      // element the service gave no geometry for.
      return myScriptRecognisedLines(response, lines, request.lines);
    },

    async convertMaths(request: MyScriptRequest): Promise<MyScriptLatex> {
      const response = await post(request);
      return myScriptLatex(response);
    },
  };
}

/**
 * The maths-to-LaTeX conversion the plan asks for, on demand.
 *
 * Takes one ink line and returns the LaTeX in a `$$` block with the alternatives
 * the engine offered. It is a free function rather than a method because the plan's
 * wording is "a derivation converts on demand": the call site decides when, and
 * nothing in this module ever converts on its own.
 *
 * It throws when no key was supplied rather than returning an empty string. An
 * empty conversion and a refused one look identical downstream, and only one of
 * them means the text stayed on this machine.
 */
export async function convertToLatex(
  line: InkLine,
  options: MyScriptOptions & {
    /** BCP 47 tag for the derivation; `en` where the caller has none. */
    lang?: string;
    /** Convert through an engine the caller already built, rather than a fresh one. */
    recogniser?: Pick<MyScriptRecogniser, "convertMaths">;
    /** A pre-built maths request, so a caller with several lines makes one call. */
    request?: MyScriptRequest;
  } = {},
): Promise<{ latex: string; alternatives?: string[] }> {
  if (!isMyScriptConfigured(options)) {
    throw new Error(
      "MyScript is not configured: no application key was supplied, and this engine never runs without one (§5.2).",
    );
  }
  const request =
    options.request ??
    myScriptRequestBody(
      [line],
      { lang: options.lang ?? "en" },
      {
        contentType: MYSCRIPT_CONTENT_TYPES.math,
        ...(options.scale === undefined ? {} : { scale: options.scale }),
      },
    );
  const engine =
    options.recogniser ??
    createMyScriptRecogniser({
      applicationKey: options.applicationKey,
      ...(options.scheme === undefined ? {} : { scheme: options.scheme }),
      ...(options.host === undefined ? {} : { host: options.host }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.scale === undefined ? {} : { scale: options.scale }),
    });
  const converted = await engine.convertMaths(request);
  const latex = latexBlock(converted.latex);
  return converted.alternatives && converted.alternatives.length > 0
    ? { latex, alternatives: [...converted.alternatives] }
    : { latex };
}
