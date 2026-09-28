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
  "edit_vault_note",
  "append_vault_note",
  "report_edit",
  "milestone_status",
  "experiment_update",
  "paper_annotation",
] as const;
export type AiProposalKind = (typeof AI_PROPOSAL_KINDS)[number];

/** Drafts do not access Zotero. A future approved write still needs encrypted credentials. */
export const AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS: readonly AiProposalKind[] = [];

export const AI_TOOL_NAMES = [
  "search_workspace",
  "get_source_excerpt",
  "get_workspace_outline",
  "suggest_append_paper_note",
  "suggest_create_vault_note",
  "suggest_create_log_entry",
  "suggest_paper_update",
  "suggest_paper_field_value",
  "suggest_reading_list_change",
  "suggest_relation",
  "suggest_zotero_import",
  "suggest_milestone_follow_up",
  "suggest_experiment_follow_up",
] as const;
export type AiToolName = (typeof AI_TOOL_NAMES)[number];

/** Pre-rename `propose_*` names still resolve; they are accepted, never listed. */
export function canonicalAiToolName(name: string): string {
  return name.startsWith("propose_") ? `suggest_${name.slice("propose_".length)}` : name;
}

/**
 * A provider identifier. Open on purpose: any OpenAI- or Anthropic-compatible
 * endpoint is a valid provider here, including a local Ollama or an
 * organisation's own gateway, and a closed union would have forced every one of
 * those into "custom".
 *
 * There is deliberately no default ordering. Ranking providers in the type
 * layer is how a supposedly neutral system acquires a favourite; which model
 * runs is the user's choice, made explicitly in settings.
 */
export type AiModelProviderId = string;

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
