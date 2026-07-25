import { NextResponse } from "next/server";
import { requireSdkUser } from "@/app/api/sdk/_shared";

export const dynamic = "force-dynamic";

const ROW_FIELDS =
  "id,project_id,connection_id,title,overleaf_project_id,entry_file,external_url,enabled,last_fetched_at,last_error,section_targets,created_at,updated_at";

/**
 * Validates the { sectionKey -> targetWords } map the client sends. Keys are
 * lowercased title paths; values are positive whole-word targets, or null to
 * clear one. Anything malformed is rejected rather than silently stored.
 */
function sanitizeSectionTargets(input: unknown): Record<string, number> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!key || key.length > 500) return null;
    if (value === null) continue; // cleared target — drop the key
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > 10_000_000) return null;
    out[key] = value;
  }
  return out;
}

/** Overleaf project ids appear in a clone URL, so keep them to safe path atoms. */
const OVERLEAF_PROJECT_ID = /^[A-Za-z0-9_-]+$/;
const ENTRY_FILE = /^[A-Za-z0-9._/-]+$/;

function entryFileError(entryFile: string): string | null {
  if (!ENTRY_FILE.test(entryFile) || entryFile.startsWith("/") || entryFile.includes("..")) {
    return "Entry file path is invalid.";
  }
  return null;
}

/** Canonical, never user-supplied: this link sits beside a stored credential. */
function externalUrl(overleafProjectId: string): string {
  return `https://www.overleaf.com/project/${overleafProjectId}`;
}

export async function GET(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;
  const projectId = new URL(request.url).searchParams.get("projectId");
  let query = auth.db.from("overleaf_linked_reports")
    .select(ROW_FIELDS)
    .order("updated_at", { ascending: false });
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reports: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;
  let body: { projectId?: string; connectionId?: string; title?: string; overleafProjectId?: string; entryFile?: string };
  try { body = await request.json() as typeof body; } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const projectId = body.projectId?.trim();
  const connectionId = body.connectionId?.trim();
  const title = body.title?.trim();
  const overleafProjectId = body.overleafProjectId?.trim();
  const entryFile = body.entryFile?.trim() || "main.tex";
  if (!projectId || !connectionId || !title || !overleafProjectId) return NextResponse.json({ error: "Project, connection, title, and Overleaf project id are required." }, { status: 400 });
  if (!OVERLEAF_PROJECT_ID.test(overleafProjectId)) return NextResponse.json({ error: "Overleaf project id is invalid." }, { status: 400 });
  const entryFileInvalid = entryFileError(entryFile);
  if (entryFileInvalid) return NextResponse.json({ error: entryFileInvalid }, { status: 400 });
  const [{ data: project }, { data: connection }] = await Promise.all([
    auth.db.from("projects").select("id").eq("id", projectId).eq("user_id", auth.userId).maybeSingle(),
    auth.db.from("overleaf_connections").select("id").eq("id", connectionId).eq("user_id", auth.userId).maybeSingle(),
  ]);
  if (!project || !connection) return NextResponse.json({ error: "Project or Overleaf connection not found." }, { status: 404 });
  const { data, error } = await auth.db.from("overleaf_linked_reports").insert({
    user_id: auth.userId, project_id: projectId, connection_id: connectionId, title,
    overleaf_project_id: overleafProjectId, entry_file: entryFile,
    external_url: externalUrl(overleafProjectId),
  }).select(ROW_FIELDS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ report: data }, { status: 201 });
}

/**
 * Edit a link row. Only this app's record changes — nothing is written to
 * Overleaf, which stays the source of truth for the document itself.
 */
export async function PATCH(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;
  let body: { id?: string; title?: string; overleafProjectId?: string; entryFile?: string; sectionTargets?: unknown };
  try { body = await request.json() as typeof body; } catch { return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }); }

  const id = body.id?.trim();
  if (!id) return NextResponse.json({ error: "Report id required." }, { status: 400 });

  const patch: Record<string, string | null | Record<string, number>> = {};

  if (body.sectionTargets !== undefined) {
    const targets = sanitizeSectionTargets(body.sectionTargets);
    if (!targets) return NextResponse.json({ error: "Section targets are invalid." }, { status: 400 });
    patch.section_targets = targets;
  }

  if (body.title !== undefined) {
    const title = body.title.trim();
    if (!title) return NextResponse.json({ error: "Title cannot be empty." }, { status: 400 });
    patch.title = title;
  }

  if (body.overleafProjectId !== undefined) {
    const overleafProjectId = body.overleafProjectId.trim();
    if (!overleafProjectId) return NextResponse.json({ error: "Overleaf project id cannot be empty." }, { status: 400 });
    if (!OVERLEAF_PROJECT_ID.test(overleafProjectId)) return NextResponse.json({ error: "Overleaf project id is invalid." }, { status: 400 });
    patch.overleaf_project_id = overleafProjectId;
    // Recomputed, not carried over: a stale link would point at the old project.
    patch.external_url = externalUrl(overleafProjectId);
  }

  if (body.entryFile !== undefined) {
    const entryFile = body.entryFile.trim() || "main.tex";
    const invalid = entryFileError(entryFile);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
    patch.entry_file = entryFile;
  }

  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  // Pointing at a different project or file invalidates what was fetched under
  // the old target, so clear the cached result rather than leave it misattributed.
  if (patch.overleaf_project_id || patch.entry_file) patch.last_error = null;

  const { data, error } = await auth.db.from("overleaf_linked_reports")
    .update(patch)
    .eq("id", id)
    .eq("user_id", auth.userId)
    .select(ROW_FIELDS)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Report not found." }, { status: 404 });
  return NextResponse.json({ report: data });
}

/** Unlinks the report here. The Overleaf project is untouched. */
export async function DELETE(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "Report id required." }, { status: 400 });
  const { error, count } = await auth.db.from("overleaf_linked_reports")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("user_id", auth.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!count) return NextResponse.json({ error: "Report not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
