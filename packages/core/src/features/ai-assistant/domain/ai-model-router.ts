import type { AiModelRequest, AiModelResponse, IModelConversation, AiModelProviderId } from "./ai-types.js";


export interface AiModelAdapter extends IModelConversation {
  readonly available: boolean;
}

/**
 * Provider-neutral router.
 *
 * Selection is explicit: the caller names the provider it wants. There is no
 * fallback order, because a silent fallback means the user believes they are
 * talking to one model while another answers — which is worse than an error
 * telling them their choice is unavailable.
 */
export class AiModelRouter implements IModelConversation {
  readonly provider: AiModelProviderId;
  private readonly adapter: AiModelAdapter;

  constructor(adapters: readonly AiModelAdapter[], selected: AiModelProviderId) {
    if (!selected) {
      throw new Error("No AI provider is configured. Choose one in Settings → AI.");
    }
    const match = adapters.find(
      (adapter) => adapter.provider === selected && adapter.available,
    );
    if (!match) {
      const available = adapters.filter((a) => a.available).map((a) => a.provider);
      throw new Error(
        available.length
          ? `AI provider "${selected}" is not available. Configured: ${available.join(", ")}.`
          : `AI provider "${selected}" is not available and none are configured.`,
      );
    }
    this.adapter = match;
    this.provider = match.provider;
  }

  complete(request: AiModelRequest): Promise<AiModelResponse> {
    return this.adapter.complete(request);
  }

}
