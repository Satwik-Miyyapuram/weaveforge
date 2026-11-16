/**
 * Input size guard shared by the wrapper modules. Not re-exported.
 */
import {
  maxIndexTextUtf16 as rawMaxIndexTextUtf16,
} from "../pkg/wf_wasm.js";

/** Throws before the text is copied into WASM, which would grow linear memory for good. */
export function checkIndexText(text: string): void {
  const max = rawMaxIndexTextUtf16();
  if (text.length > max) {
    throw new RangeError(`text is ${text.length} UTF-16 units; MAX_INDEX_TEXT_UTF16 is ${max}`);
  }
}
