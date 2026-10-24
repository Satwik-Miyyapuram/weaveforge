import { NextResponse } from "next/server";
import { requireSdkUser } from "@/app/api/sdk/_shared";
import { sealCredentialString, openCredentialString } from "@/features/settings/infrastructure/settings-credential-crypto";
import { formatErrorForResponse, jsonBodyError } from "@/lib/format-error";
import { cleanSecrets, saveCredentials } from "./_credentials";

export const dynamic = "force-dynamic";

/** Read + decrypt the caller's integration credentials. */
export async function GET(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.db
    .from("user_settings")
    .select("credentials_enc, zotero_api_key, semantic_scholar_key, integrations")
    .maybeSingle();
  if (error) return NextResponse.json({ error: formatErrorForResponse(error, "credentials") }, { status: 500 });

  // Prefer the sealed envelope; fall back to any legacy plaintext columns.
  if (data?.credentials_enc) {
    try {
      const secrets = cleanSecrets(JSON.parse(openCredentialString(data.credentials_enc as string)));
      return NextResponse.json(secrets, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      // Our own crypto rather than the database, but the message can still name
      // a key or a parameter. `formatErrorForResponse` passes a plain
      // configuration error through unchanged (which is the SDK's debuggability
      // requirement) and replaces anything that carries a SQLSTATE.
      return NextResponse.json({ error: formatErrorForResponse(err, "credentials") }, { status: 500 });
    }
  }
  const legacy = cleanSecrets({
    zoteroApiKey: (data?.zotero_api_key as string) ?? undefined,
    semanticScholarKey: (data?.semantic_scholar_key as string) ?? undefined,
    integrations: data?.integrations ?? undefined,
  });
  return NextResponse.json(legacy, { headers: { "Cache-Control": "no-store" } });
}

/** Seal + store the caller's integration credentials; clears legacy plaintext. */
export async function POST(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch (err) {
    return NextResponse.json({ error: jsonBodyError(err) }, { status: 400 });
  }
  return saveCredentials({ db: auth.db, userId: auth.userId, seal: sealCredentialString }, body);
}
