import { NextResponse } from "next/server";

interface CollectionRow {
  data?: { key?: string; name?: string };
}

function unexpected(reason: unknown): NextResponse {
  // Logged without the request: the API key must never reach a log.
  console.warn("[zotero-collections] unexpected response:", reason);
  return NextResponse.json({ error: "Zotero sent an unexpected response." }, { status: 502 });
}

/**
 * Turns Zotero's answer into the route's. A body that is not a list of rows is
 * Zotero misbehaving, and saying "unable to reach" about it would send the
 * reader to check a connection that works.
 */
export async function collectionsResponse(response: Response): Promise<NextResponse> {
  if (!response.ok) {
    return NextResponse.json(
      { error: "Zotero rejected the collection request." },
      { status: response.status === 401 ? 401 : 502 },
    );
  }
  let rows: unknown;
  try {
    rows = await response.json();
  } catch (error) {
    return unexpected(error);
  }
  if (!Array.isArray(rows) || !rows.every((row) => typeof row === "object" && row !== null)) {
    return unexpected(Array.isArray(rows) ? "a row is not an object" : `not a list (${rows === null ? "null" : typeof rows})`);
  }
  const collections = (rows as CollectionRow[])
    .map((row) => ({ key: row.data?.key ?? "", name: row.data?.name ?? "" }))
    .filter((collection) => collection.key);
  return NextResponse.json({ collections }, { headers: { "Cache-Control": "no-store" } });
}
