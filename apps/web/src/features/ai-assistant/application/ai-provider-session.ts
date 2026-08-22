import { ModelConceptExtractor, type IConceptExtractor } from "@weaveforge/core";
import { desktop } from "@/lib/desktop/desktop-bridge";
import {
  ByokModelConversation,
  type ProviderApi,
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
 *
 * The desktop build may keep it across launches, and only because the machine
 * offers somewhere this app does not manage: `remember` hands it to the
 * operating system's keychain through the shell (`readSecret`/`writeSecret`),
 * where it is encrypted under the reader's own account. That is a different
 * thing from localStorage, not a relaxation of the rule above — the rule is
 * that we do not hold the key, and a keychain the OS owns does not become
 * storage we manage by being convenient. In a browser the functions below are
 * no-ops, so the memory-only behaviour is the default everywhere and the
 * exception has to be asked for.
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

/** The name the shell files this under. */
const SECRET = "ai-provider" as const;

/** Whether this build can keep a key at all — false in every browser. */
export function canRemember(): boolean {
  return desktop() !== null;
}

/**
 * Hand the configured provider to the machine's keychain.
 *
 * Rejects rather than reporting success when there is nothing configured or no
 * keychain backend, because the caller renders the difference: a refusal means
 * the key is still live for this session and will be gone after a reload,
 * which the reader has to be told rather than left to discover.
 */
export async function rememberActiveProvider(): Promise<void> {
  const bridge = desktop();
  if (!bridge) throw new Error("This build cannot store keys.");
  if (!active) throw new Error("No provider is configured.");
  await bridge.writeSecret(SECRET, JSON.stringify(active));
}

/** Forget the stored copy, if this build has one. Leaves the session alone. */
export async function forgetStoredProvider(): Promise<void> {
  await desktop()?.clearSecret(SECRET);
}

/**
 * Restore a remembered provider, and answer whether there was one.
 *
 * Anything unreadable counts as nothing stored. The blob is written by this
 * module, but it survives upgrades that change the descriptor's shape, and a
 * half-valid provider would fail later at the model call — where the message
 * would be the provider's rather than ours.
 */
export async function restoreActiveProvider(): Promise<boolean> {
  const bridge = desktop();
  if (!bridge) return false;
  const stored = await bridge.readSecret(SECRET);
  if (!stored) return false;
  const parsed = parseStored(stored);
  if (!parsed) return false;
  setActiveProvider(parsed.descriptor, parsed.apiKey);
  return true;
}

const APIS: readonly ProviderApi[] = ["openai-chat", "anthropic-messages", "ollama"];

function parseStored(raw: string): ActiveProvider | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const { descriptor, apiKey } = value as { descriptor?: unknown; apiKey?: unknown };
  if (typeof apiKey !== "string" || !descriptor || typeof descriptor !== "object") return null;
  const { id, label, baseUrl, api, model } = descriptor as Record<string, unknown>;
  if (typeof id !== "string" || typeof label !== "string") return null;
  if (typeof baseUrl !== "string" || typeof model !== "string") return null;
  if (!APIS.includes(api as ProviderApi)) return null;
  return { descriptor: { id, label, baseUrl, api: api as ProviderApi, model }, apiKey };
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
