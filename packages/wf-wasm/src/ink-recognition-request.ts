/**
 * The ink recognition request check (Rust `ink::recognition_request`), re-exported from index.ts.
 * Keeps the signature of apps/desktop/src/ink-recogniser.ts. Hand-typed: the result type is not
 * in bindings.ts.
 */
import { readInkRequest as rawReadInkRequest } from "../pkg/wf_wasm.js";
import type { InkRecognitionLineInput } from "./bindings.js";

export type { InkRecognitionLineInput } from "./bindings.js";

/** Narrowing: readonly arrays here; generated type is mutable. */
export interface InkRecognitionRequest {
  lines: readonly InkRecognitionLineInput[];
  vocabulary?: readonly string[];
  lang?: string;
}

/**
 * The page's request, checked whole: lines of strokes of finite numbers, an optional word list and
 * an optional language. Anything else is null. Never throws.
 */
export function readInkRequest(request: unknown): InkRecognitionRequest | null {
  return rawReadInkRequest(request) as InkRecognitionRequest | null;
}
