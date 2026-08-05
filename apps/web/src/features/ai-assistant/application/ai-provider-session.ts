import { ModelConceptExtractor, type IConceptExtractor } from "@thesis/core";
import {
  ByokModelConversation,
  type ProviderDescriptor,
} from "../infrastructure/byok-model-conversation";

/**
 * The model the user has pointed at, for as long as the tab is open.
 *
 * In memory only. The key is a credential the user controls, and writing it to
 * localStorage or IndexedDB would turn it into one this app stores — recoverable
 * by anything that can read the origin's storage, and outliving the session that
 * needed it. The cost is re-entering it after a reload, which is the honest
 * price of not holding it.
 *
 * A module-level value rather than React state because the wiki screen and the
 * settings panel are unrelated trees, and threading a provider through a context
 * would put a credential in the component graph for no gain.
 */

interface ActiveProvider {
  descriptor: ProviderDescriptor;
  apiKey: string;
}

let active: ActiveProvider | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to configuration changes. Returns an unsubscribe function. */
export function onProviderChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setActiveProvider(descriptor: ProviderDescriptor, apiKey: string): void {
  active = { descriptor, apiKey };
  notify();
}

export function clearActiveProvider(): void {
  active = null;
  notify();
}

/** What is configured, without the key — safe to render. */
export function activeProviderLabel(): { label: string; model: string } | null {
  return active ? { label: active.descriptor.label, model: active.descriptor.model } : null;
}

export function hasActiveProvider(): boolean {
  return active !== null;
}

/**
 * A model-backed extractor, or null when nothing is configured.
 *
 * Returning null rather than throwing lets callers fall back to the lexical
 * extractor, which is the point of having one: the wiki works with no key at
 * all, and a configured model makes it better rather than making it possible.
 */
export function modelExtractor(): IConceptExtractor | null {
  if (!active) return null;
  const conversation = new ByokModelConversation(active.descriptor, active.apiKey);
  return new ModelConceptExtractor(conversation, { model: active.descriptor.model });
}
