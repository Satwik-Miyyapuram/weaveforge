import { rust } from "../../../shared/rust.js";
import type { ExtractionRequest, ExtractionResult, IConceptExtractor } from "./ai-extraction.js";
import type {
  AiModelProviderId,
  AiModelRequest,
  AiModelResponse,
  AiProposalKind,
  IModelConversation,
} from "./ai-types.js";

// --- ai-model-router ---
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

// --- lexical-concept-extractor ---
/**
 * Concept extraction with no model at all.
 *
 * The harvesting, merging and ranking live in the Rust core (wf-core
 * `ai::lexical_concepts`). This class is the host shim: it hands the documents
 * over and returns what comes back.
 */
export class LexicalConceptExtractor implements IConceptExtractor {
  readonly id = "lexical";

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    // Absent optional fields are left out rather than sent as undefined, which would reach wasm as null.
    return rust().extractLexical({
      documents: request.documents.map((doc) => ({
        id: doc.id,
        ...(doc.text === undefined ? {} : { text: doc.text }),
      })),
      ...(request.maxConcepts === undefined ? {} : { maxConcepts: request.maxConcepts }),
    }) as ExtractionResult;
  }
}

// --- mcp-folder-draft ---
/** Where the local MCP leaves suggestions for the app to pick up; never applied on its own. */
export const FOLDER_DRAFTS_DIR = ".weaveforge/proposals";

/** One suggestion written to the folder by the local MCP, before the app imports it. */
export interface FolderDraft {
  kind: AiProposalKind;
  tool: string;
  resourceId: string;
  resourceType?: string;
  content: string;
  payload?: Record<string, unknown>;
  sourceLinks?: string[];
  expectedRevision?: string;
  createdAt?: string;
  /** The project it belongs to; absent means whichever project imports it. */
  projectId?: string;
}
