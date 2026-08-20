import { NextResponse } from "next/server";
import { requireSdkUser } from "@/app/api/sdk/_shared";
import { zoteroHeaders, zoteroLibraryUrl } from "@/features/papers/infrastructure/zotero-web-api";

export const dynamic = "force-dynamic";

interface CollectionRow {
  data?: { key?: string; name?: string };
}

/**
 * Zotero does not allow browser CORS requests. The key is accepted only for
 * this request, never persisted or logged, and the response is not cached.
 */

/**
 * How long Zotero has to answer.
 *
 * `fetch` with no signal waits for as long as the other end cares to take, and
 * this one runs on the server — a Zotero having a bad day would hold a request
 * open rather than fail. The `catch` below already says the right thing when it
 * does; this is what makes the catch reachable.
 */
const TIMEOUT_MS = 10_000;
export async function POST(request: Request) {
  const auth = await requireSdkUser(request);
  if (!auth.ok) return auth.response;

  let body: { apiKey?: string; library?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const apiKey = body.apiKey?.trim();
  const libraryInput = body.library?.trim();
  const library = libraryInput && /^\d+$/.test(libraryInput) ? `users/${libraryInput}` : libraryInput;
  if (!apiKey || !library || !/^(users|groups)\/\d+$/.test(library)) {
    return NextResponse.json({ error: "A valid Zotero library and API key are required." }, { status: 400 });
  }

  try {
    const response = await fetch(`${zoteroLibraryUrl(library)}/collections?limit=100`, {
      headers: zoteroHeaders(apiKey),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return NextResponse.json({ error: "Zotero rejected the collection request." }, { status: response.status === 401 ? 401 : 502 });
    }
    const rows = await response.json() as CollectionRow[];
    const collections = rows
      .map((row) => ({ key: row.data?.key ?? "", name: row.data?.name ?? "" }))
      .filter((collection) => collection.key);
    return NextResponse.json({ collections }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to reach Zotero." }, { status: 502 });
  }
}
