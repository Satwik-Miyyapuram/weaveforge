/**
 * The stored vector file's framing (Rust `search::vector_codec`): a length-prefixed
 * JSON head, then the vector blob.
 */
import {
  unpackVectorBlob as rawUnpackVectorBlob,
  unpackVectorHead as rawUnpackVectorHead,
} from "../pkg/wf_wasm.js";

import type {
  VectorFileHead,
} from "./bindings.js";

export {
  packVectors,
} from "../pkg/wf_wasm.js";

export type { VectorFileHead };

/** A file's JSON head, or `null` if it is torn or its head is not valid. */
export function unpackVectorHead(file: Uint8Array): VectorFileHead | null {
  return rawUnpackVectorHead(file) as VectorFileHead | null;
}

/** A file's vector blob, or `undefined` if it is torn or its head is not valid. */
export function unpackVectorBlob(file: Uint8Array): Uint8Array | undefined {
  return rawUnpackVectorBlob(file);
}

/** A file's head and blob, or `null` if it is torn or its head is not valid. */
export function unpackVectors(file: Uint8Array): (VectorFileHead & { bytes: Uint8Array }) | null {
  const head = unpackVectorHead(file);
  const bytes = unpackVectorBlob(file);
  if (head === null || bytes === undefined) return null;
  return { ...head, bytes };
}
