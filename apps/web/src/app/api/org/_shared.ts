import { NextResponse } from "next/server";
import { readBackendConfig } from "@/backend/config";
import { OrgInviteService } from "@/features/org/infrastructure/org-invite-service";
import { httpStatusForError } from "@weaveforge/core";
import { formatError } from "@/lib/format-error";
import { bearerToken } from "@/lib/bearer-token";

function orgApiService(): OrgInviteService {
  const cfg = readBackendConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseServiceRoleKey) {
    throw new Error("Missing Supabase service role config.");
  }
  return new OrgInviteService(cfg.supabaseUrl, cfg.supabaseServiceRoleKey);
}

/**
 * The status comes from the error's type, in core, so every org route answers
 * the same way for the same condition. Hard-coding it per route is what made
 * `OrgValidationError` a 400 on one endpoint and a 403 on another (review-2 F5).
 */
export function orgApiErrorResponse(err: unknown) {
  const message = formatError(err);
  return NextResponse.json({ error: message }, { status: httpStatusForError(err) });
}

export async function requireOrgApiUser(request: Request): Promise<
  | { ok: true; svc: OrgInviteService; userId: string }
  | { ok: false; response: NextResponse }
> {
  const token = bearerToken(request);
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }) };
  }
  try {
    const svc = orgApiService();
    const userId = await svc.resolveUserId(token);
    if (!userId) {
      return { ok: false, response: NextResponse.json({ error: "Invalid session." }, { status: 401 }) };
    }
    return { ok: true, svc, userId };
  } catch (err) {
    return { ok: false, response: orgApiErrorResponse(err) };
  }
}
