/**
 * Resource-type to search-kind policy (Rust `search_index_state`). Which kinds a
 * write can change; the stale set itself stays in the TS class.
 */
import {
  kindsForResource as rawKindsForResource,
  resourceTypes as rawResourceTypes,
} from "../pkg/wf_wasm.js";
import type { SearchKind } from "./bindings.js";

/** Kinds a write to `resourceType` can change, or `null` when unmapped (full rebuild). */
export function kindsForResource(resourceType: string): SearchKind[] | null {
  return rawKindsForResource(resourceType) as SearchKind[] | null;
}

/** Every mapped resource type, in table order. */
export function resourceTypes(): string[] {
  return rawResourceTypes() as string[];
}
