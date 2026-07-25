import { NextResponse } from "next/server";
import { requireSdkUser } from "@/app/api/sdk/_shared";
import { sealCredentialString, openCredentialString } from "@/features/settings/infrastructure/settings-credential-crypto";

export const dynamic = "force-dynamic";

type Secrets = {
  zoteroApiKey?: string;
  semanticScholarKey?: string;
  integrations?: Record<string, Record<string, string>>;
};

function clean(input: Secrets): Secrets {
  const out: Secrets = {};
  const z = input.zoteroApiKey?.trim();
  const s = input.semanticScholarKey?.trim();
  if (z) out.zoteroApiKey = z;
  if (s) out.semanticScholarKey = s;
  if (input.integrations) {
    const integrations: Record<string, Record<string, string>> = {};
    for (const [provider, fields] of Object.entries(input.integrations)) {
      const kept = Object.fromEntries(Object.entries(fields).filter(([, v]) => v?.trim()));
      if (Object.keys(kept).length > 0) integrations[provider] = kept;
    }
    if (Object.keys(integrations).length > 0) out.integrations = integrations;
  }
  return out;
}

/** Read + decrypt the caller's integration credentials. */
export async function GET(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.db
    .from("user_settings")
    .select("credentials_enc, zotero_api_key, semantic_scholar_key, integrations")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Prefer the sealed envelope; fall back to any legacy plaintext columns.
  if (data?.credentials_enc) {
    try {
      const secrets = clean(JSON.parse(openCredentialString(data.credentials_enc as string)) as Secrets);
      return NextResponse.json(secrets, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
    }
  }
  const legacy = clean({
    zoteroApiKey: (data?.zotero_api_key as string) ?? undefined,
    semanticScholarKey: (data?.semantic_scholar_key as string) ?? undefined,
    integrations: (data?.integrations as Record<string, Record<string, string>>) ?? undefined,
  });
  return NextResponse.json(legacy, { headers: { "Cache-Control": "no-store" } });
}

/** Seal + store the caller's integration credentials; clears legacy plaintext. */
export async function POST(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;

  let body: Secrets;
  try {
    body = (await request.json()) as Secrets;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const secrets = clean(body);
  const credentials_enc = Object.keys(secrets).length > 0 ? sealCredentialString(JSON.stringify(secrets)) : null;

  const { error } = await auth.db.from("user_settings").upsert(
    {
      user_id: auth.userId,
      credentials_enc,
      zotero_api_key: null,
      semantic_scholar_key: null,
      integrations: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
