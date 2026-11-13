import type {
  AiModelAdapter,
  AiModelRequest,
  AiModelResponse,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

/**
 * Bring-your-own-key model access, called straight from the browser.
 *
 * Deliberately not proxied through a Next route. A proxy would put the user's
 * API key on your server — turning a credential they control into one you
 * store, log, and are liable for — and would meter their usage through your
 * infrastructure for no benefit to either party.
 *
 * The trade is CORS: OpenAI-compatible endpoints and Ollama allow browser
 * calls, and Anthropic allows them behind an explicit opt-in header. Any
 * endpoint that refuses is simply not usable this way, which is a clearer
 * outcome than silently routing it through a server.
 *
 * The request shape and the reply parsing live in Rust (`ai::byok_wire`); this
 * file keeps only the fetch, the timeout and the key in memory.
 */

export type ProviderApi = "openai-chat" | "anthropic-messages" | "ollama";

export interface ProviderDescriptor {
  id: string;
  label: string;
  baseUrl: string;
  api: ProviderApi;
  model: string;
}

/** Starting points for the settings UI. Nothing here is privileged. */
export const PROVIDER_PRESETS: readonly Omit<ProviderDescriptor, "model">[] = [
  { id: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com", api: "anthropic-messages" },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com", api: "openai-chat" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api", api: "openai-chat" },
  { id: "ollama", label: "Ollama (local)", baseUrl: "http://localhost:11434", api: "ollama" },
  { id: "lmstudio", label: "LM Studio (local)", baseUrl: "http://localhost:1234", api: "openai-chat" },
];

/** How long one reply may take. Local models on a laptop can be slow, so this is generous. */
export const BYOK_TIMEOUT_MS = 180_000;

interface ChatMessage {
  role: string;
  content: string;
}

/**
 * One adapter over three wire formats. They differ only in where the system
 * prompt goes, how auth is presented, and where the text lands in the response.
 */
export class ByokModelConversation implements AiModelAdapter {
  readonly provider: string;

  constructor(
    private readonly descriptor: ProviderDescriptor,
    /** Held in memory only — never persisted, never sent anywhere but the provider. */
    private readonly apiKey: string,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly timeoutMs: number = BYOK_TIMEOUT_MS,
  ) {
    this.provider = descriptor.id;
  }

  /** Local providers need no key; hosted ones are unusable without one. */
  get available(): boolean {
    return readyCore().byokAvailable(this.descriptor, this.apiKey);
  }

  async complete(request: AiModelRequest): Promise<AiModelResponse> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    try {
      return await this.send(request, signal);
    } catch (err) {
      if (signal.aborted) {
        throw new Error(`${this.descriptor.label} did not answer within ${Math.round(this.timeoutMs / 1000)}s.`);
      }
      throw err;
    }
  }

  private async send(request: AiModelRequest, signal: AbortSignal): Promise<AiModelResponse> {
    const messages = request.messages as readonly ChatMessage[];
    const { url, headers, body } = readyCore().buildByokRequest(this.descriptor, this.apiKey, messages);

    const response = await this.fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      // Surface the provider's own message: "insufficient quota" or "model not
      // found" is far more use than a generic failure.
      const detail = await response.text().catch(() => "");
      throw new Error(readyCore().byokHttpError(this.descriptor.label, response.status, detail));
    }

    const text = readyCore().parseByokReply(this.descriptor.api, await response.json());
    if (text === null) throw new Error(`${this.descriptor.label} returned an empty response.`);
    return {
      text,
      model: this.descriptor.model,
      provider: this.provider,
      sourceLinks: [],
    };
  }
}
