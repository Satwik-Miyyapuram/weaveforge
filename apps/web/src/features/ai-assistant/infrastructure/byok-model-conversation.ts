import type {
  AiModelAdapter,
  AiModelRequest,
  AiModelResponse,
} from "@weaveforge/core";

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

interface ChatMessage {
  role: string;
  content: string;
}

function splitSystem(messages: readonly ChatMessage[]) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  return { system, rest };
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
  ) {
    this.provider = descriptor.id;
  }

  /** Local providers need no key; hosted ones are unusable without one. */
  get available(): boolean {
    return this.descriptor.api === "ollama" || this.apiKey.trim().length > 0;
  }

  async complete(request: AiModelRequest): Promise<AiModelResponse> {
    const messages = request.messages as readonly ChatMessage[];
    const { url, headers, body } = this.buildRequest(messages);

    const response = await this.fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Surface the provider's own message: "insufficient quota" or "model not
      // found" is far more use than a generic failure.
      const detail = await response.text().catch(() => "");
      throw new Error(
        `${this.descriptor.label} returned ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      );
    }

    return {
      text: this.extractText(await response.json()),
      model: this.descriptor.model,
      provider: this.provider,
      sourceLinks: [],
    };
  }

  private buildRequest(messages: readonly ChatMessage[]): {
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  } {
    const base = this.descriptor.baseUrl.replace(/\/+$/, "");
    const { system, rest } = splitSystem(messages);

    if (this.descriptor.api === "anthropic-messages") {
      return {
        url: `${base}/v1/messages`,
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          // Anthropic blocks browser calls unless this opt-in is present.
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: {
          model: this.descriptor.model,
          max_tokens: 4096,
          ...(system ? { system } : {}),
          messages: rest,
        },
      };
    }

    if (this.descriptor.api === "ollama") {
      return {
        url: `${base}/api/chat`,
        headers: { "content-type": "application/json" },
        body: { model: this.descriptor.model, messages, stream: false },
      };
    }

    return {
      url: `${base}/v1/chat/completions`,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: { model: this.descriptor.model, messages },
    };
  }

  private extractText(payload: unknown): string {
    const data = payload as Record<string, unknown>;

    if (this.descriptor.api === "anthropic-messages") {
      const content = data.content as { type?: string; text?: string }[] | undefined;
      return (content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");
    }

    if (this.descriptor.api === "ollama") {
      return ((data.message as { content?: string } | undefined)?.content ?? "").trim();
    }

    const choices = data.choices as { message?: { content?: string } }[] | undefined;
    return (choices?.[0]?.message?.content ?? "").trim();
  }
}
