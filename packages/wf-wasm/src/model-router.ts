/**
 * AI provider selection (Rust `ai::model_router::select_model_provider`), re-exported from index.ts.
 * A refusal throws its message as a string; callers wrap it in an Error.
 */
import { selectModelProvider as rawSelectModelProvider } from "../pkg/wf_wasm.js";
import type { ModelProviderAvailability } from "./bindings.js";

export type { ModelProviderAvailability } from "./bindings.js";

/** The provider `selected` names, which must be available. Throws the router's message when refused. */
export function selectModelProvider(providers: readonly ModelProviderAvailability[], selected: string): string {
  return rawSelectModelProvider(providers, selected);
}
