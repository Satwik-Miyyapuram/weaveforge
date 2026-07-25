import type { AiModelRequest, AiModelResponse, IModelConversation, AiModelProviderId } from "./ai-types.js";
import { AI_MODEL_PROVIDER_ORDER } from "./ai-types.js";

export interface AiModelAdapter extends IModelConversation {
  readonly available: boolean;
}

/** Provider-neutral router. Codex is preferred when registered and available. */
export class AiModelRouter implements IModelConversation {
  readonly provider: AiModelProviderId;
  private readonly adapter: AiModelAdapter;

  constructor(adapters: readonly AiModelAdapter[], preferred?: AiModelProviderId) {
    const order = preferred ? [preferred, ...AI_MODEL_PROVIDER_ORDER.filter((id) => id !== preferred)] : AI_MODEL_PROVIDER_ORDER;
    const selected = order
      .map((provider) => adapters.find((adapter) => adapter.provider === provider && adapter.available))
      .find((adapter): adapter is AiModelAdapter => Boolean(adapter));
    if (!selected) throw new Error("No AI model adapter is available");
    this.adapter = selected;
    this.provider = selected.provider;
  }

  complete(request: AiModelRequest): Promise<AiModelResponse> {
    return this.adapter.complete(request);
  }

}
