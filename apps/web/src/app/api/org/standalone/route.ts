import { NextResponse } from "next/server";
import { createRestClient } from "@/backend/providers/supabase/client";
import { readBackendConfig } from "@/backend/config";
import { bearerToken } from "@/lib/bearer-token";
import { formatErrorForResponse } from "@/lib/format-error";

/** Standalone onboarding — anon key + user JWT, no service role. */
export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const cfg = readBackendConfig();
  const url = cfg.supabaseUrl;
  const anonKey = cfg.supabaseAnonKey;
  if (!url || !anonKey) {
    return NextResponse.json({ error: "Missing Supabase URL or anon key." }, { status: 500 });
  }

  const db = createRestClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { error: userErr } = await db.auth.getUser(token);
  if (userErr) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  const { error } = await db.rpc("complete_org_setup");
  if (error) {
    // `complete_org_setup` is a definer RPC; when it fails it can report a table
    // or column by name. Sanitised rather than returned verbatim.
    return NextResponse.json({ error: formatErrorForResponse(error, "org-standalone") }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
