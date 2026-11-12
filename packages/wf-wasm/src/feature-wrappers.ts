/**
 * Everything index.ts re-exports besides its own wrappers: the raw wasm-bindgen exports
 * (typed in Rust), the generated bindings types, the browser-glue modules, and the
 * constants and TS-only types wasm-bindgen cannot export.
 */
export * from "./modules.js";
export * from "../pkg/wf_wasm.js";
export type * from "./bindings.js";
export * from "./ts-types.js";

// Names more than one source exports: explicit exports pick the caller-facing one.
export { isTypingTarget, mergeOverleafProjects, overleafProjectMatches, toRenderStrokes } from "./modules.js";
export type { BibPaperInput } from "../pkg/wf_wasm.js";
export type { BibPaperInput as BibPaperInputRow } from "./bindings.js";
export type {
  AiPolicyDecision,
  AnchorStrategy,
  CiteSpan,
  CitationPageTextItem,
  NewReaderAnnotation,
  ReaderAnnotation,
  TextSegment,
  DocumentPageText,
  DocumentSearchMatch,
  PdfIndexSource,
  PdfPageText,
  ReaderContainerSize,
  ReaderPageSize,
  ReaderViewportState,
} from "./ts-types.js";
export type { DropEntry as PdfDropEntry, GraphLink as GLink } from "./bindings.js";
export { overleafExternalUrl as externalUrl } from "../pkg/wf_wasm.js";
