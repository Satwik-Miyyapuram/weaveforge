import type { KindCount, MigrationState } from "../domain/report";
import type { FileCodec, FileSink, Row, ServerSource } from "../domain/ports";
import { sha256Hex } from "../domain/hash";
import { SERVER_ONLY_FIELDS } from "../domain/server-only-fields";

/** Local-only sync bookkeeping: never part of the server row or the file, so never compared. */
const LOCAL_ONLY_FIELDS = ["syncState"];

/** The server row without its server-only columns, so only file-backed fields are compared. */
function withoutServerOnly(kind: string, row: Row): Row {
  const skip = new Set([...(SERVER_ONLY_FIELDS[kind] ?? []), ...LOCAL_ONLY_FIELDS]);
  return Object.fromEntries(Object.entries(row).filter(([k]) => !skip.has(k)));
}

/** Compared form of a row: a null blob contentType and octet-stream are the same "unknown" type. */
function comparable(kind: string, row: Row): Row {
  const out = withoutServerOnly(kind, row);
  if (kind === "blobs") out.contentType = out.contentType ?? "application/octet-stream";
  return out;
}

/** True when two row lists hold the same rows after server-only fields are dropped (order-free). */
export function sameRows(kind: string, want: Row[], got: Row[]): boolean {
  const a = want.map((r) => canon(comparable(kind, r))).sort();
  const b = got.map((r) => canon(comparable(kind, r))).sort();
  return a.length === b.length && a.every((w, i) => w === b[i]);
}

export type VerifyInput = {
  kinds: readonly string[];
  codec: FileCodec;
  source: ServerSource;
  sink: FileSink;
};

export type Verdict = {
  state: MigrationState;
  kinds: Record<string, Pick<KindCount, "db" | "files">>;
  blobs: { db: number; verified: number };
  errors: string[];
};

/** Key-order-independent JSON, so equal rows compare equal however they were decoded. */
function canon(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Names the first row id and field that differ, so a failed verify says where to look. */
function firstDifference(kind: string, expected: Row[], decoded: Row[]): string {
  const want = new Map(expected.map((r) => [String(r.id), comparable(kind, r)] as const));
  const got = new Map(decoded.map((r) => [String(r.id), comparable(kind, r)] as const));
  for (const [id, w] of want) {
    const g = got.get(id);
    if (!g) return `id ${id} missing from files`;
    const fields = [...new Set([...Object.keys(w), ...Object.keys(g)])].sort();
    const field = fields.find((k) => canon(w[k]) !== canon(g[k]));
    if (field !== undefined) return `id ${id} field ${field} differs`;
  }
  for (const id of got.keys()) if (!want.has(id)) return `id ${id} extra in files`;
  return "row count differs";
}

/**
 * Strict gate. Reads the server rows again and decodes every file in the sink.
 * Verified only when, for every kind, the decoded files equal the server rows,
 * and every blob's bytes and sidecar match the server sha256.
 * Any read error is recorded and makes the state incomplete.
 */
export async function verifyExport(input: VerifyInput): Promise<Verdict> {
  const { kinds, codec, source, sink } = input;
  const errors: string[] = [];
  const out: Verdict = { state: "incomplete", kinds: {}, blobs: { db: 0, verified: 0 }, errors };

  const files = await sink.list();
  for (const kind of kinds) {
    try {
      const expected = await source.listRows(kind);
      if (!codec.supports(kind)) {
        out.kinds[kind] = { db: expected.length, files: 0 };
        continue;
      }
      const decoded: Row[] = [];
      for (const path of files) {
        const row = codec.toRow(kind, path, await sink.readText(path));
        if (row) decoded.push(row);
      }
      out.kinds[kind] = { db: expected.length, files: decoded.length };
      const want = expected.map((row) => canon(comparable(kind, row))).sort();
      const got = decoded.map((row) => canon(comparable(kind, row))).sort();
      if (want.length !== got.length || want.some((w, i) => w !== got[i])) {
        const first = firstDifference(kind, expected, decoded);
        errors.push(`${kind}: decoded files differ from server rows (first: ${first})`);
      }
    } catch (err) {
      errors.push(`${kind}: read failed`);
    }
  }

  try {
    const refs = await source.listBlobs();
    out.blobs.db = refs.length;
    for (const ref of refs) {
      const path = `assets/${ref.bucket}/${ref.path}`;
      try {
        const bytes = await sink.readBytes(path);
        // Line 1 is the sha256; line 2 (the content type) is not compared here. Checked against
        // the local bytes and the server size only: the server records no sha256.
        const sidecar = (await sink.readText(`${path}.sha256`)).split("\n")[0];
        if (bytes.length !== ref.sizeBytes) errors.push(`blob ${path}: size mismatch`);
        else if ((await sha256Hex(bytes)) !== sidecar) errors.push(`blob ${path}: sha256 mismatch`);
        else out.blobs.verified++;
      } catch (err) {
        errors.push(`blob ${path}: read failed`);
      }
    }
  } catch (err) {
    errors.push("blobs: read failed");
  }

  const kindsOk = kinds.every((k) => {
    const c = out.kinds[k];
    return c !== undefined && c.db === c.files;
  });
  out.state =
    errors.length === 0 && kindsOk && out.blobs.db === out.blobs.verified ? "verified" : "incomplete";
  return out;
}
