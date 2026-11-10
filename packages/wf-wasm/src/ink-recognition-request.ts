/**
 * The ink recognition request check and builder (Rust `ink::recognition_request`), re-exported
 * from index.ts. Keeps the signature of apps/desktop/src/ink-recogniser.ts. Types come from
 * bindings.ts.
 */
import type {
  InkRecognitionRequest,
  InkRequestBuildInput,
} from "./bindings.js";

export {
  buildInkRequest,
  readInkRequest,
} from "../pkg/wf_wasm.js";

export type {
  InkRecognitionLineInput,
  InkRecognitionRequest,
  InkRequestBuildInput,
} from "./bindings.js";

