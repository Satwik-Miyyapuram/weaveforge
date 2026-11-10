import type { AiModelRequest, AiModelResponse, IModelConversation, AiModelProviderId } from "./ai-types.js";
import { rust } from "../../../shared/rust.js";


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
    // The choice and its refusal messages live in Rust (wf-core `ai::model_router`).
    let chosen: string;
    try {
      chosen = rust().selectModelProvider(
        adapters.map(({ provider, available }) => ({ provider, available })),
        selected,
      );
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    const match = adapters.find((adapter) => adapter.provider === chosen && adapter.available);
    if (!match) throw new Error(`AI provider "${chosen}" is not available.`);
    this.adapter = match;
    this.provider = match.provider;
  }

  complete(request: AiModelRequest): Promise<AiModelResponse> {
    return this.adapter.complete(request);
  }

}
