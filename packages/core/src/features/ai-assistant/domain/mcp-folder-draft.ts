import type { AiProposalKind } from "./ai-types.js";

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

/** Signatures of the functions that moved to the Rust core (wf-wasm, crates/wf-core/src/ai/folder_draft.rs). */
export interface McpFolderDraftFns {
  /** A draft file's JSON, or null when it is not one; the file is agent-written, so nothing is trusted. */
  parseFolderDraft(raw: string): FolderDraft | null;
}