import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { readBackendConfig } from "@/backend/config";

function bearerToken(request: Request): string | null {
  return request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
}

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

  const db = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { error: userErr } = await db.auth.getUser(token);
  if (userErr) {
    return NextResponse.json({ error: "Invalid session." }, { status: 401 });
  }

  const { error } = await db.rpc("complete_org_setup");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
