/**
 * MyScript iink: the opt-in cloud engine, as a recogniser, a mapper, and a
 * maths-to-LaTeX conversion (§5.2, §7 step 10).
 *
 * This is the only engine in `INK_ENGINE_ORDER` that is **not** offline, and
 * the only one that sends anything anywhere. §5.2's privacy line is a promise that
 * engines 1–2 never send strokes anywhere and engine 5 does, so three rules are
 * built into this folder rather than left to a caller:
 *
 * 1. **Off by default.** Nothing here reads an environment variable, a settings
 *    store or a global. A key is a caller-supplied option and
 *    `isMyScriptConfigured` is the gate; an empty or whitespace key is not a
 *    key, because a settings field submits empty strings.
 * 2. **Never enabled without a key.** `createMyScriptRecogniser`'s
 *    `available()` resolves `false` when there is no key, so the selector in
 *    `recognise.ts` skips this engine without a network touch. `recognise()` and
 *    `convertToLatex` throw instead of silently falling back, because a
 *    caller that asked for MyScript and got something else would be told the note
 *    stayed on the machine when it did not.
 * 3. **The note records the engine.** `id` is `"myscript@1"`, which is what
 *    `ink-engine` in the note's frontmatter is written from (§4.5), so a reviewer
 *    opening the file can see the text was produced off-machine.
 *
 * **This implementation is a stub in one specific sense: no key ships and no call
 * is made here or in the tests.** The interface, the request/response mapping, the
 * gate and a contract test against a *recorded* response are the whole of step 10;
 * the caller passes a real key when the owner decides to pay for one, and the first
 * real call is the one that leaves the machine.
 *
 * ## The upstream shape, and why the mapping is one module each way
 *
 * iinkTS' HTTP batch client (`src/client/HTTPClientV2.ts`) POSTs to
 * `…/api/v4.0/iink/recognize` with a JSON body of `scaleX`/`scaleY`,
 * `contentType`, `configuration` and one flat object per **stroke** — `id`,
 * `pointerType` and parallel `x`/`y`/`t`/`p` arrays. What comes back is keyed by
 * MIME type: `application/vnd.myscript.jiix` for text (`elements[]` of `Text` and
 * `Math` elements carrying a `label` and `candidates`), and `application/x-latex`
 * for maths, which is a **string** rather than an element tree.
 *
 * Three consequences are load-bearing here, and all three are why the mapper is
 * factored rather than inlined:
 *
 * - **The "endpoint" in the plan is a parameter, not a second URL.** There is one
 *   URL; `contentType: "Text"` produces JIIX text and `contentType: "Math"` with
 *   the LaTeX export produces the maths, so maths → LaTeX is *the same endpoint
 *   with a different `contentType` and `export.mimeTypes`*.
 *   `myScriptRequestBody` (in `./request.ts`) is the single place that knows
 *   that, which is what "a schema change is one function" is supposed to mean.
 * - **The service sees strokes, not lines, and answers with elements.** The batch
 *   body is flat, so lines are flattened into one stroke list; the response is
 *   grouped back into lines by each element's position relative to the page,
 *   because JIIX carries a `bounding-box` and neither the element order nor the
 *   units it answered in are part of the contract.
 * - **Everything the caller sees comes back through those two modules**, and
 *   nothing else in this folder knows a property name.
 *
 * **What does not survive the round trip:** vocabulary hints and confidence. The
 * v4 batch endpoint documents no word-list parameter, so `hints.vocabulary` is
 * dropped for the same reason `InkAnalyzer` drops it (§5.3's measured note: the
 * §5.4 post-match is the only path that helps). JIIX reports no per-line score, so
 * every mapped line carries `MYSCRIPT_DEFAULT_CONFIDENCE` — a constant of
 * the format rather than an invented measurement, for the same reason the Windows
 * helper reports `1`/`0` instead of guessing. One further loss is stated where it
 * happens (`./request.ts`): the note keeps one time per stroke, so the service
 * sees a straight time ramp rather than true velocity.
 *
 * ## The pieces
 *
 * - `./vocabulary.ts` — the words a caller reads: ids, MIME types, defaults, the
 *   options type and the key gate. No network, no strokes.
 * - `./request.ts` — the request schema, one function: lines and hints in, the
 *   flat batch body and its line table out.
 * - `./response.ts` — the response schema, one function each way: elements in,
 *   per-line readings placed by geometry.
 * - `./latex.ts` — the maths half's reading: LaTeX from a response, and the
 *   `$$` block the note writes.
 * - `./engine.ts` — the recogniser the selector picks, and the on-demand
 *   `convertToLatex`, both refusing to run without a key.
 */
export {
  MYSCRIPT_ENGINE_ID,
  MYSCRIPT_DEFAULT_HOST,
  MYSCRIPT_ENDPOINT_PATH,
  MYSCRIPT_JIIX_MIME,
  MYSCRIPT_LATEX_MIME,
  MYSCRIPT_CONTENT_TYPES,
  MYSCRIPT_DEFAULT_CONFIDENCE,
  MYSCRIPT_DEFAULT_SCALE,
  MYSCRIPT_DEFAULT_TIMEOUT_MS,
  isMyScriptConfigured,
  type MyScriptContentType,
  type MyScriptFetch,
  type MyScriptOptions,
} from "./vocabulary.js";
export {
  myScriptRequestBody,
  type MyScriptStrokeBody,
  type MyScriptRequestLine,
  type MyScriptRequestBody,
  type MyScriptRequest,
  type MyScriptRequestOptions,
} from "./request.js";
export {
  myScriptRecognisedLines,
  type MyScriptResponseElement,
  type MyScriptExportResponse,
} from "./response.js";
export { myScriptLatex, latexBlock, type MyScriptLatex } from "./latex.js";
export { convertToLatex, createMyScriptRecogniser, type MyScriptRecogniser } from "./engine.js";
