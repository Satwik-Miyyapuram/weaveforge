import { AI_PROPOSAL_KINDS, type AiProposalKind } from "./ai-types.js";

/** Where the local MCP leaves suggestions for the app to pick up; never applied on its own. */
export const FOLDER_DRAFTS_DIR = ".weaveforge/proposals";

const MAX_RAW_CHARS = 256 * 1024;
const MAX_CONTENT_CHARS = 64 * 1024;
const MAX_ID_CHARS = 512;

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
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** A draft file's JSON, or null when it is not one; the file is agent-written, so nothing is trusted. */
export function parseFolderDraft(raw: string): FolderDraft | null {
  if (raw.length > MAX_RAW_CHARS) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(value)) return null;

  const kind = value.kind;
  if (typeof kind !== "string" || !(AI_PROPOSAL_KINDS as readonly string[]).includes(kind)) return null;
  const resourceId = optionalString(value.resourceId);
  if (!resourceId || resourceId.length > MAX_ID_CHARS) return null;
  const content = optionalString(value.content);
  if (!content || content.length > MAX_CONTENT_CHARS) return null;
  if (value.payload !== undefined && !isPlainObject(value.payload)) return null;
  const links = value.sourceLinks;
  if (links !== undefined && !(Array.isArray(links) && links.every((l) => typeof l === "string"))) return null;

  return {
    kind: kind as AiProposalKind,
    tool: optionalString(value.tool) ?? "local-mcp",
    resourceId,
    resourceType: optionalString(value.resourceType),
    content,
    payload: value.payload as Record<string, unknown> | undefined,
    sourceLinks: links as string[] | undefined,
    expectedRevision: optionalString(value.expectedRevision),
    createdAt: optionalString(value.createdAt),
  };
}
