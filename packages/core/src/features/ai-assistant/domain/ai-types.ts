/** Privacy and capability contracts shared by the in-app assistant and future MCP adapter. */

export const AI_RESOURCE_TYPES = [
  "paper",
  "paper_note",
  "zotero_annotation",
  "zotero_note",
  "reading_list",
  "citation_graph",
  "vault_page",
  "log_entry",
  "experiment",
  "milestone",
] as const;
export type AiResourceType = (typeof AI_RESOURCE_TYPES)[number];

export const AI_READ_CATEGORIES = [
  "paper_metadata",
  "paper_notes",
  "zotero_annotations",
  "reading_lists",
  "vault_notes",
  "logbook",
  "experiments",
] as const;
export type AiReadCategory = (typeof AI_READ_CATEGORIES)[number];

export const AI_PROPOSAL_KINDS = [
  "append_paper_note",
  "create_vault_note",
  "create_log_entry",
  "paper_update",
  "paper_field_value",
  "reading_list_change",
  "relation",
  "zotero_import",
  "milestone_follow_up",
  "experiment_follow_up",
] as const;
export type AiProposalKind = (typeof AI_PROPOSAL_KINDS)[number];

/** Drafts do not access Zotero. A future approved write still needs encrypted credentials. */
export const AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS: readonly AiProposalKind[] = [];

export const AI_TOOL_NAMES = [
  "search_workspace",
  "get_source_excerpt",
  "get_workspace_outline",
  "propose_append_paper_note",
  "propose_create_vault_note",
  "propose_create_log_entry",
  "propose_paper_update",
  "propose_paper_field_value",
  "propose_reading_list_change",
  "propose_relation",
  "propose_zotero_import",
  "propose_milestone_follow_up",
  "propose_experiment_follow_up",
] as const;
export type AiToolName = (typeof AI_TOOL_NAMES)[number];

export type AiModelProviderId =
  | "codex"
  | "openai"
  | "anthropic"
  | "google"
  | "ollama"
  | "custom";

/** Codex is the preferred client path; the rest remain adapter-compatible. */
export const AI_MODEL_PROVIDER_ORDER: readonly AiModelProviderId[] = [
  "codex",
  "openai",
  "anthropic",
  "google",
  "ollama",
  "custom",
];

export interface AiAccessSettings {
  enabled: boolean;
  disclosureAcceptedAt?: string;
  readCategories: readonly AiReadCategory[];
  proposalKinds: readonly AiProposalKind[];
  autoIncludeNewSourceCategories?: readonly AiReadCategory[];
}

export interface AiWorkspaceSource {
  sourceId: string;
  resourceType: AiResourceType;
  resourceId: string;
  label?: string;
  /** Same-origin deep link for human verification; never contains plaintext. */
  href?: string;
}

export interface AiWorkspace {
  id: string;
  name: string;
  description?: string;
  sources: readonly AiWorkspaceSource[];
  createdAt: string;
  updatedAt: string;
}

export interface AiSessionGrant {
  id: string;
  workspaceId: string;
  expiresAt: string;
  readable: readonly AiWorkspaceSource[];
  allowedTools: readonly AiToolName[];
  proposalCapabilities: readonly AiProposalKind[];
  requiresConfirmationForWrites: true;
}

export interface AiSourceLink {
  sourceId: string;
  label: string;
  resourceType: AiResourceType;
  resourceId: string;
  href?: string;
}

export interface AiModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface AiModelRequest {
  messages: readonly AiModelMessage[];
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface AiModelResponse {
  text: string;
  model: string;
  provider: AiModelProviderId;
  sourceLinks: readonly AiSourceLink[];
}

export interface IModelConversation {
  readonly provider: AiModelProviderId;
  complete(request: AiModelRequest): Promise<AiModelResponse>;
  stream?(request: AiModelRequest): AsyncIterable<AiModelResponse>;
}
