import { NextResponse } from "next/server";
import { readBackendConfig } from "@/backend/config";
import { OrgInviteService } from "@/features/org/infrastructure/org-invite-service";
import { OrgInviteValidationError, OrgValidationError } from "@weaveforge/core";

export function orgApiService(): OrgInviteService {
  const cfg = readBackendConfig();
  if (!cfg.supabaseUrl || !cfg.supabaseServiceRoleKey) {
    throw new Error("Missing Supabase service role config.");
  }
  return new OrgInviteService(cfg.supabaseUrl, cfg.supabaseServiceRoleKey);
}

export function bearerToken(request: Request): string | null {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
}

export function orgApiErrorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const status =
    err instanceof OrgInviteValidationError || err instanceof OrgValidationError ? 400 : 500;
  return NextResponse.json({ error: message }, { status });
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
