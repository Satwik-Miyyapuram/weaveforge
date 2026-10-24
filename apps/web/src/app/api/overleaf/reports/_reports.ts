import { NextResponse } from "next/server";
import type { ApiCaller } from "@/app/api/sdk/_shared";
import { formatErrorForResponse } from "@/lib/format-error";
import {
  entryFileError,
  externalUrl,
  OVERLEAF_PROJECT_ID,
  sanitizeSectionTargets,
} from "@/features/overleaf/domain/link-rules";

type Caller = Pick<ApiCaller, "db" | "userId">;

export const ROW_FIELDS =
  "id,project_id,connection_id,title,overleaf_project_id,entry_file,external_url,enabled,last_fetched_at,last_error,section_targets,created_at,updated_at";

const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });

/** The parsed JSON body as a record, or null when it is not a plain object. */
function asObject(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? body as Record<string, unknown> : null;
}

/** The first of `fields` that is present but not a string, if any. */
function nonStringField(body: Record<string, unknown>, fields: readonly string[]): string | null {
  return fields.find((field) => body[field] !== undefined && typeof body[field] !== "string") ?? null;
}

export async function createLinkedReport(caller: Caller, raw: unknown) {
  const body = asObject(raw);
  if (!body) return badRequest("Request body must be a JSON object.");
  const wrong = nonStringField(body, ["projectId", "connectionId", "title", "overleafProjectId", "entryFile"]);
  if (wrong) return badRequest(`${wrong} must be a string.`);
  const text = body as { projectId?: string; connectionId?: string; title?: string; overleafProjectId?: string; entryFile?: string };
  const projectId = text.projectId?.trim();
  const connectionId = text.connectionId?.trim();
  const title = text.title?.trim();
  const overleafProjectId = text.overleafProjectId?.trim();
  const entryFile = text.entryFile?.trim() || "main.tex";
  if (!projectId || !connectionId || !title || !overleafProjectId) return badRequest("Project, connection, title, and Overleaf project id are required.");
  if (!OVERLEAF_PROJECT_ID.test(overleafProjectId)) return badRequest("Overleaf project id is invalid.");
  const entryFileInvalid = entryFileError(entryFile);
  if (entryFileInvalid) return badRequest(entryFileInvalid);
  const [projectLookup, connectionLookup] = await Promise.all([
    caller.db.from("projects").select("id").eq("id", projectId).eq("user_id", caller.userId).maybeSingle(),
    caller.db.from("overleaf_connections").select("id").eq("id", connectionId).eq("user_id", caller.userId).maybeSingle(),
  ]);
  // A lookup that failed says nothing about whether the row exists.
  const lookupError = projectLookup.error ?? connectionLookup.error;
  if (lookupError) return NextResponse.json({ error: formatErrorForResponse(lookupError, "overleaf-reports") }, { status: 500 });
  if (!projectLookup.data || !connectionLookup.data) return NextResponse.json({ error: "Project or Overleaf connection not found." }, { status: 404 });
  const { data, error } = await caller.db.from("overleaf_linked_reports").insert({
    user_id: caller.userId, project_id: projectId, connection_id: connectionId, title,
    overleaf_project_id: overleafProjectId, entry_file: entryFile,
    external_url: externalUrl(overleafProjectId),
  }).select(ROW_FIELDS).single();
  if (error) return NextResponse.json({ error: formatErrorForResponse(error, "overleaf-reports") }, { status: 500 });
  return NextResponse.json({ report: data }, { status: 201 });
}

/**
 * Edit a link row. Only this app's record changes — nothing is written to
 * Overleaf, which stays the source of truth for the document itself.
 */
export async function patchLinkedReport(caller: Caller, raw: unknown) {
  const body = asObject(raw);
  if (!body) return badRequest("Request body must be a JSON object.");
  const wrong = nonStringField(body, ["id", "title", "overleafProjectId", "entryFile"]);
  if (wrong) return badRequest(`${wrong} must be a string.`);
  const text = body as { id?: string; title?: string; overleafProjectId?: string; entryFile?: string; sectionTargets?: unknown };

  const id = text.id?.trim();
  if (!id) return badRequest("Report id required.");

  const patch: Record<string, string | null | Record<string, number>> = {};

  if (text.sectionTargets !== undefined) {
    const targets = sanitizeSectionTargets(text.sectionTargets);
    if (!targets) return badRequest("Section targets are invalid.");
    patch.section_targets = targets;
  }

  if (text.title !== undefined) {
    const title = text.title.trim();
    if (!title) return badRequest("Title cannot be empty.");
    patch.title = title;
  }

  if (text.overleafProjectId !== undefined) {
    const overleafProjectId = text.overleafProjectId.trim();
    if (!overleafProjectId) return badRequest("Overleaf project id cannot be empty.");
    if (!OVERLEAF_PROJECT_ID.test(overleafProjectId)) return badRequest("Overleaf project id is invalid.");
    patch.overleaf_project_id = overleafProjectId;
    // Recomputed, not carried over: a stale link would point at the old project.
    patch.external_url = externalUrl(overleafProjectId);
  }

  if (text.entryFile !== undefined) {
    const entryFile = text.entryFile.trim() || "main.tex";
    const invalid = entryFileError(entryFile);
    if (invalid) return badRequest(invalid);
    patch.entry_file = entryFile;
  }

  if (!Object.keys(patch).length) return badRequest("Nothing to update.");

  // Pointing at a different project or file invalidates what was fetched under
  // the old target, so clear the cached result rather than leave it misattributed.
  if (patch.overleaf_project_id || patch.entry_file) patch.last_error = null;

  const { data, error } = await caller.db.from("overleaf_linked_reports")
    .update(patch)
    .eq("id", id)
    .eq("user_id", caller.userId)
    .select(ROW_FIELDS)
    .maybeSingle();
  if (error) return NextResponse.json({ error: formatErrorForResponse(error, "overleaf-reports") }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Report not found." }, { status: 404 });
  return NextResponse.json({ report: data });
}
