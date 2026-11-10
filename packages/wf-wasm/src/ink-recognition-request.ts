/**
 * The ink recognition request check and builder (Rust `ink::recognition_request`), re-exported
 * from index.ts. Keeps the signature of apps/desktop/src/ink-recogniser.ts. Types come from
 * bindings.ts.
 */
import {
  buildInkRequest as rawBuildInkRequest,
  readInkRequest as rawReadInkRequest,
} from "../pkg/wf_wasm.js";
import type { InkRecognitionRequest, InkRequestBuildInput } from "./bindings.js";

export type {
  InkRecognitionLineInput,
  InkRecognitionRequest,
  InkRequestBuildInput,
} from "./bindings.js";

/**
 * The page's request, checked whole: lines of strokes of finite numbers, an optional word list and
 * an optional language. Anything else is null. Never throws.
 */
export function readInkRequest(request: unknown): InkRecognitionRequest | null {
  return rawReadInkRequest(request) as InkRecognitionRequest | null;
}

/**
 * The helper's request for a page: each stroke flattened to `x, y, pressure` triples, vocabulary
 * always sent, language only when given.
 */
export function buildInkRequest(input: InkRequestBuildInput): InkRecognitionRequest {
  return rawBuildInkRequest(input) as InkRecognitionRequest;
}
