/**
 * Maths → LaTeX, the response half: read whichever shape the service answered
 * with, and offer the block the note writes.
 *
 * Split from the engine (see `./index.ts`) because the LaTeX *reading* is a
 * pure mapping — it never leaves the machine — while the *call* is the part
 * that needs a key and a fetch.
 */
import { MYSCRIPT_LATEX_MIME } from "./vocabulary.js";
import { collectResponseLines } from "./response.js";
import type { MyScriptExportResponse } from "./response.js";

/** A converted derivation: the LaTeX, and the other readings the engine offered. */
export interface MyScriptLatex {
  /** The LaTeX body, without the `$$` fences. */
  latex: string;
  /** Other readings, best first, for a correction UI. */
  alternatives?: string[];
}

/**
 * A maths line as the note writes it: a `$$` block (§7 step 10).
 *
 * The fences are added here rather than by the caller so the fenced and unfenced
 * forms cannot drift apart: {@link convertToLatex} returns the block, and
 * {@link MyScriptLatex.latex} stays bare for a caller that wants to preview the
 * body inline without stripping markers back off.
 */
export function latexBlock(latex: string): string {
  return `$$\n${latex.trim()}\n$$`;
}

/**
 * The LaTeX in one response, when the request asked for maths.
 *
 * This is the response half of {@link convertToLatex}: it reads whichever shape
 * the service answered with — the dedicated `application/x-latex` string first,
 * because that is the one the maths content type guarantees, then an element's
 * label — and returns the alternatives alongside it. An empty answer is an empty
 * `latex`, never a thrown error: a conversion that found nothing is a fact about
 * the handwriting, while a failed conversion is a fact about the call.
 */
export function myScriptLatex(response: MyScriptExportResponse | null): MyScriptLatex {
  if (!response) return { latex: "" };
  const direct = response[MYSCRIPT_LATEX_MIME];
  if (typeof direct === "string" && direct.trim().length > 0) {
    return { latex: direct.trim() };
  }

  const first = collectResponseLines(response).find((entry) => entry.text.length > 0);
  if (!first) return { latex: "" };
  return first.alternatives.length > 0
    ? { latex: first.text, alternatives: [...first.alternatives] }
    : { latex: first.text };
}
