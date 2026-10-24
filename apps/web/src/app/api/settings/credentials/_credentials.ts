import { NextResponse } from "next/server";
import { formatErrorForResponse } from "@/lib/format-error";

export type Secrets = {
  zoteroApiKey?: string;
  semanticScholarKey?: string;
  integrations?: Record<string, Record<string, string>>;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function trimmed(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Keep only non-empty string secrets; anything malformed is dropped, never thrown on. */
export function cleanSecrets(input: unknown): Secrets {
  const out: Secrets = {};
  if (!isObject(input)) return out;
  const z = trimmed(input.zoteroApiKey);
  const s = trimmed(input.semanticScholarKey);
  if (z) out.zoteroApiKey = z;
  if (s) out.semanticScholarKey = s;
  if (isObject(input.integrations)) {
    const integrations: Record<string, Record<string, string>> = {};
    for (const [provider, fields] of Object.entries(input.integrations)) {
      if (!isObject(fields)) continue;
      const kept: Record<string, string> = {};
      for (const [k, v] of Object.entries(fields)) if (trimmed(v)) kept[k] = v as string;
      if (Object.keys(kept).length > 0) integrations[provider] = kept;
    }
    if (Object.keys(integrations).length > 0) out.integrations = integrations;
  }
  return out;
}

type UpsertDb = {
  from(table: string): {
    upsert(row: Record<string, unknown>, opts: { onConflict: string }): PromiseLike<{ error: unknown }>;
  };
};

export type SaveCredentialsDeps = {
  db: UpsertDb;
  userId: string;
  seal: (plain: string) => string;
};

/** Seal + store the caller's credentials and clear the legacy plaintext columns. */
export async function saveCredentials({ db, userId, seal }: SaveCredentialsDeps, body: unknown): Promise<NextResponse> {
  if (!isObject(body)) {
    return NextResponse.json({ error: "Body must be a JSON object." }, { status: 400 });
  }
  const secrets = cleanSecrets(body);
  let credentials_enc: string | null;
  try {
    credentials_enc = Object.keys(secrets).length > 0 ? seal(JSON.stringify(secrets)) : null;
  } catch (err) {
    return NextResponse.json({ error: formatErrorForResponse(err, "settings-credentials") }, { status: 500 });
  }

  const { error } = await db.from("user_settings").upsert(
    {
      user_id: userId,
      credentials_enc,
      zotero_api_key: null,
      semantic_scholar_key: null,
      integrations: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    return NextResponse.json({ error: formatErrorForResponse(error, "settings-credentials") }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
