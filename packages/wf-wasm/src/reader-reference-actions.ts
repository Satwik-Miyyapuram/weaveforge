/**
 * Reference popover rules: the paper reference a bibliography entry resolves by,
 * and the fields a manual add can fill (R5), re-exported from index.ts. The adds
 * themselves stay in packages/core and apps/web.
 */
import {
  manualInputFromReference as rawManualInputFromReference,
  referenceRef as rawReferenceRef,
} from "../pkg/wf_wasm.js";

/** The bibliographic hints a title search carries (Rust `ReferenceHints`). */
export interface ReferenceHints {
  title?: string;
  year?: number;
  firstAuthor?: string;
}

/** The paper reference a bibliography entry resolves by (Rust `ReferenceRef`). */
export type ReferenceRef =
  | { kind: "doi"; value: string }
  | { kind: "arxiv"; value: string }
  | { kind: "bibliographic"; value: string; hints: ReferenceHints };

/** The fields a manual add can fill from an entry (Rust `ManualPaperInput`). */
export interface ManualPaperInput {
  title: string;
  status: "to_read";
  authors?: string[];
  year?: number;
  doi?: string;
  arxivId?: string;
  url?: string;
}

/** The paper reference a bibliography entry resolves by (Rust `reference_ref`). */
export function referenceRef(entry: unknown): ReferenceRef {
  return rawReferenceRef(entry) as ReferenceRef;
}

/** The fields a manual add can fill from an entry, without inventing any (Rust `manual_input_from_reference`). */
export function manualInputFromReference(entry: unknown): ManualPaperInput {
  return rawManualInputFromReference(entry) as ManualPaperInput;
}
