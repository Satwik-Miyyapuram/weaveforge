/** AI assistant Rust function signatures (access, evidence, retrieval, sessions, drafts). */
import type { ExtractionResult } from "../../features/ai-assistant/domain/ai-extraction.js";
import type { PdfLocus } from "../../reader/anchor-shapes.js";
import type { AiAccessSettings, AiProposalKind, AiSessionGrant, AiToolName, AiWorkspace, AiWorkspaceSource, AiModelRequest, AiReadCategory, AiResourceType, AiRetrievalDocument, AiRetrievedExcerpt, ExcerptHighlight, McpResult, McpResultOptions, MergeInput, MergeResult, UntrustedItem } from "../../features/ai-assistant/domain/ai-types.js";

/** Signatures of the functions that moved to the Rust core (wf-wasm, crates/wf-core/src/ai). */
export interface AiAccessPolicyFns {
  aiReadCategoryForResource(resourceType: AiResourceType): AiReadCategory;
}

export interface AiEvidenceFns {
  /** Split the excerpt around the used sentence; null when there is no locus or no match. */
  highlightWithinExcerpt(excerpt: string, locus: PdfLocus | undefined): ExcerptHighlight | null;
}

export interface AiMcpResultFns {
  /** Said to the calling agent, outside the fence, about what is inside it. */
  readonly MCP_RESULT_NOTICE: string;
  /** Characters of any single item. Past this, an excerpt stops being an excerpt. */
  readonly MAX_ITEM_CHARS: 8000;
  /** Characters of a whole result. One call must not be able to drain a library. */
  readonly MAX_RESULT_CHARS: 32000;
  /**
   * Turn read-tool output into one bounded, fenced, self-describing result.
   *
   * Items are taken in order until the budget runs out rather than shrunk to fit.
   * A caller ranks its results, and half of each of twenty notes is less use to
   * an agent than the whole of the first five, with an honest count of the rest.
   */
  mcpReadResult(items: readonly UntrustedItem[], options?: McpResultOptions): McpResult;
}

export interface AiRetrievalFns {
  retrieveAiExcerpts(
    documents: readonly AiRetrievalDocument[],
    query: string,
    options: { limit?: number; maxChars?: number },
  ): readonly AiRetrievedExcerpt[];
}

export interface UntrustedContextFns {
  /**
   * A fresh boundary marker.
   *
   * `Math.random` is deliberate: this is not a secret and authenticates nothing.
   * It has one job — being unknown to text written before the request was made —
   * and any source of surprise does that job.
   */
  contextNonce(random?: () => number): string;
  /**
   * Strip what a document could use to escape its own fence.
   *
   * The nonce itself goes first: a document that somehow learned it — from an
   * earlier answer quoted back into a note, say — must not be able to spend it.
   * Then the generic turn markers, and the invisible characters that would let a
   * document smuggle them past a person reviewing the same note by eye.
   */
  neutraliseContext(text: string, nonce: string): string;
  /** A label is one line of someone else's text; it must not draw structure. */
  safeLabel(label: string, nonce: string): string;
  /**
   * Fence the items into one block for a user turn.
   *
   * The block names its own boundary so the model can tell where the data ends
   * even when a document tries to look like the end of it.
   */
  fenceUntrusted(items: readonly UntrustedItem[], nonce: string): string;
}

export interface WikiMergeFns {
  /**
   * Merge `secondary` into `primary`.
   *
   * `primary` keeps its title; the other title becomes an alias, so links to
   * either continue to resolve after the merge.
   */
  mergeWikiPages(primary: MergeInput, secondary: MergeInput): MergeResult;
}

/** Signatures of the lexical extraction function (wf-core `ai::lexical_concepts`). */
export interface LexicalConceptFns {
  extractLexical(request: { documents: { id: string; text?: string }[]; maxConcepts?: number }): ExtractionResult;
}

/** Signatures of the model extraction helpers (wf-core `ai::model_extraction`). */
export interface ModelExtractionFns {
  modelExtractionLimits(): { batchSize: number; maxDocumentChars: number; knownConceptLimit: number };
  modelBuildBatchRequest(
    batch: readonly { id: string; title: string; text?: string }[],
    existing: readonly string[],
    model: string | undefined,
    maxChars: number,
    nonce: string,
  ): AiModelRequest;
  modelFinalizeExtraction(
    results: readonly ExtractionResult[],
    existing: readonly string[],
    maxConcepts: number | undefined,
  ): ExtractionResult;
}

/** Signatures of the AI session, proposal-draft, folder-draft and Overleaf status rules (wf-core `ai::session_grant`, `ai::proposal_draft`, `ai::folder_draft`, `overleaf::sync_status`). */
export interface SessionAndDraftFns {
  startAiSession(input: {
    id: string;
    workspaceName: string;
    sources: readonly AiWorkspaceSource[];
    settings: AiAccessSettings;
    encryptionUnlocked: boolean;
    now: string;
    ttlMs?: number;
    allowedTools: readonly AiToolName[];
    proposalCapabilities: readonly AiProposalKind[];
  }): { workspace: AiWorkspace; grant: AiSessionGrant; startedAt: string };
  shapeAiProposalDraft(input: {
    id: string;
    kind: AiProposalKind;
    resourceId: string;
    content: string;
    payload: unknown;
    createdAt: string;
    sourceLinks?: string[];
    expectedRevision?: string;
    evidence?: unknown[];
  }): {
    id: string;
    kind: AiProposalKind;
    resourceId: string;
    content: string;
    payload: unknown;
    createdAt: string;
    status: "pending";
    sourceLinks: string[];
    expectedRevision?: string;
    evidence?: unknown[];
  };
  isFolderDraftPath(path: string): boolean;
  folderDraftForProject(raw: string, projectId: string | undefined): unknown | null;
  describeOverleafStatus(status: { url?: string | null; branch: string; ahead: number; behind: number } | null | undefined): string;
  /** Restores a stored AI provider blob (wf-core `ai::provider_descriptor`); null when it does not match the current shape. */
  parseStoredAiProvider(raw: string): {
    descriptor: { id: string; label: string; baseUrl: string; api: "openai-chat" | "anthropic-messages" | "ollama"; model: string };
    apiKey: string;
  } | null;
}
