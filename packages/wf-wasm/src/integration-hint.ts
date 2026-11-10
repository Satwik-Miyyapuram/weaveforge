/**
 * Shared-credentials hint under a project sync descriptor (Rust
 * `integrations::shared_provider_hint`), re-exported from index.ts.
 */
import { sharedProviderHint as rawSharedProviderHint } from "../pkg/wf_wasm.js";
import type { HintDescriptor } from "./bindings.js";

export type { HintDescriptor } from "./bindings.js";

/** The hint for `descriptor` given all descriptors, or `undefined` when no sibling shares its provider. */
export function sharedProviderHint(
  descriptor: HintDescriptor,
  all: readonly HintDescriptor[],
): string | undefined {
  return (rawSharedProviderHint(descriptor, all) as string | null) ?? undefined;
}
