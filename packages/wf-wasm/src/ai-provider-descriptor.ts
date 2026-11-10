/**
 * Stored AI provider parsing (Rust `ai::provider_descriptor`), re-exported from index.ts.
 * Returns the provider, or null when the blob does not match the current shape.
 */
import { parseStoredAiProvider as rawParseStoredAiProvider } from "../pkg/wf_wasm.js";

export type AiProviderApi = "openai-chat" | "anthropic-messages" | "ollama";

export interface AiProviderDescriptor {
  id: string;
  label: string;
  baseUrl: string;
  api: AiProviderApi;
  model: string;
}

export interface AiStoredProvider {
  descriptor: AiProviderDescriptor;
  apiKey: string;
}

/** Parses a stored provider blob. Returns null for unparseable input or a mistyped field. */
export function parseStoredAiProvider(raw: string): AiStoredProvider | null {
  return rawParseStoredAiProvider(raw) as AiStoredProvider | null;
}
