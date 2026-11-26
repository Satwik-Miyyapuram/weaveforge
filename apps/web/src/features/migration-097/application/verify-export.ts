import type { KindCount, MigrationState } from "../domain/report";
import type { FileCodec, FileSink, Row, ServerSource } from "../domain/ports";
import { sha256Hex } from "../domain/hash";
import { sanitizeBlobRefs } from "../domain/asset-path";
import { conflictBasePath } from "../domain/conflict-path";
import { fromConflictCopyText } from "../domain/conflict-copy";
import { SERVER_ONLY_FIELDS } from "../domain/server-only-fields";

/** Null when the blob at `path` matches its size and sidecar sha256; otherwise the reason. */
async function checkBlob(sink: FileSink, path: string, sizeBytes: number): Promise<string | null> {
  try {
    const bytes = await sink.readBytes(path);
    // Line 1 is the sha256; line 2 (the content type) is not compared here. Checked against
    // the local bytes and the server size only: the server records no sha256.
    const sidecar = (await sink.readText(`${path}.sha256`)).split("\n")[0];
    if (bytes.length !== sizeBytes) return "size mismatch";
    if ((await sha256Hex(bytes)) !== sidecar) return "sha256 mismatch";
    return null;
  } catch {
    return "read failed";
  }
}

/** Local-only sync bookkeeping: never part of the server row or the file, so never compared. */
const LOCAL_ONLY_FIELDS = ["syncState"];

/** The server row without its server-only columns, so only file-backed fields are compared. */
function withoutServerOnly(kind: string, row: Row): Row {
  const skip = new Set([...(SERVER_ONLY_FIELDS[kind] ?? []), ...LOCAL_ONLY_FIELDS]);
  return Object.fromEntries(Object.entries(row).filter(([k]) => !skip.has(k)));
}

/** Kinds whose files store a null column as an absent key, so null and absent compare equal. */
const NULL_IS_ABSENT: ReadonlySet<string> = new Set([
  "notes", "papers", "comments", "logEntries", "experiments", "reportSections", "readingLists",
  "readingListItems", "screening", "citationAlerts", "quotationTypes", "settings", "metrics", "annotations",
]);

/** Compared form of a row: a null blob contentType and octet-stream are the same "unknown" type. */
function comparable(kind: string, row: Row): Row {
  const out = withoutServerOnly(kind, row);
  if (kind === "blobs") out.contentType = out.contentType ?? "application/octet-stream";
  if (NULL_IS_ABSENT.has(kind)) {
    // These files leave a null column out, and a note leaves out a false pinned or folder.
    for (const k of Object.keys(out)) if (out[k] === null || out[k] === undefined) delete out[k];
    if (kind === "notes") {
      if (out.pinned === false) delete out.pinned;
      if (out.folder === false) delete out.folder;
      // A note file has no kind: "note" is 0157's default (null, already dropped, reads as a note too).
      if (out.kind === "note") delete out.kind;
      // The note repo stores CRLF as LF, as the app does.
      if (typeof out.body === "string") out.body = out.body.replace(/\r\n?/g, "\n");
    }
    if (kind === "comments") {
      // The sidecar's anchor stores an absent part as "", so a "" part on the server is the same as null.
      for (const k of ["anchorQuote", "anchorPrefix", "anchorSuffix"]) if (out[k] === "") delete out[k];
    }
  }
  return out;
}

/** True when two row lists hold the same rows after server-only fields are dropped (order-free). */
export function sameRows(kind: string, want: Row[], got: Row[]): boolean {
  const a = want.map((r) => canon(comparable(kind, r))).sort();
  const b = got.map((r) => canon(comparable(kind, r))).sort();
  return a.length === b.length && a.every((w, i) => w === b[i]);
}

/**
 * For the debug log: the id of the first `want` row with no equal row in `got`, and the keys that differ from the
 * `got` row with the same id (null when no row has that id). Names keys only, never values.
 */
export function firstUnmatched(kind: string, want: Row[], got: Row[]): { id: unknown; keys: string[] | null } | null {
  const have = new Set(got.map((r) => canon(comparable(kind, r))));
  const row = want.find((r) => !have.has(canon(comparable(kind, r))));
  if (!row) return null;
  const match = got.find((r) => r.id !== undefined && r.id === row.id);
  if (!match) return { id: row.id ?? null, keys: null };
  const a = comparable(kind, row);
  const b = comparable(kind, match);
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => canon(a[k]) !== canon(b[k]));
  return { id: row.id, keys };
}

export type VerifyInput = {
  kinds: readonly string[];
  codec: FileCodec;
  source: ServerSource;
  sink: FileSink;
  /** Files left on disk on purpose (orphans): not decoded, so they cannot block the gate. */
  ignore?: ReadonlySet<string>;
  /** Conflict copies this run wrote or reused: the only copies decoded (through conflictOf). */
  copies?: ReadonlySet<string>;
  /** Folders the rows were written into: only files directly in them are decoded. Absent: every file. */
  dirs?: ReadonlySet<string>;
};

/** The folder part of `path`, "" at the root. */
export const dirOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf("/")));

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
 * Strict gate. Reads the server rows again and decodes every file in `dirs` (older per-project mirror folders are not rows of this export).
 * Verified only when, for every kind, the decoded files equal the server rows,
 * and every blob's bytes and sidecar match the server sha256.
 * Any read error is recorded and makes the state incomplete.
 */
export async function verifyExport(input: VerifyInput): Promise<Verdict> {
  const { kinds, codec, source, sink, ignore, dirs } = input;
  const copies = input.copies ?? new Set<string>();
  const errors: string[] = [];
  const out: Verdict = { state: "incomplete", kinds: {}, blobs: { db: 0, verified: 0 }, errors };

  const files = await sink.list();
  const rowFiles = dirs ? files.filter((path) => dirs.has(dirOf(path))) : files;
  // Only this run's copies count: an original is skipped when one of them holds its DB version.
  const copied = new Set([...copies].map(conflictBasePath).filter((base): base is string => base !== null));
  for (const kind of kinds) {
    try {
      const expected = await source.listRows(kind);
      if (!codec.supports(kind)) {
        out.kinds[kind] = { db: expected.length, files: 0 };
        continue;
      }
      const ids = new Set(expected.map((row) => String(row.id)));
      const decoded: Row[] = [];
      for (const path of rowFiles) {
        if (ignore?.has(path)) continue;
        if (copies.has(path)) {
          // This run's copy: its conflictOf is mapped back to the id before decoding.
          const row = codec.toRow(kind, path, fromConflictCopyText(await sink.readText(path)));
          if (row) decoded.push(row);
          continue;
        }
        // Copies from earlier runs or other devices are listed, never decoded; an original with a copy of this run is the user's edit.
        if (conflictBasePath(path) !== null || copied.has(path)) continue;
        // A file that does not read or decode as text (a PDF, a metrics chunk) is no row of this kind. A codec file
        // that fails here still fails verify: its row is missing from `decoded`.
        let row: Row | null;
        try {
          row = codec.toRow(kind, path, await sink.readText(path));
        } catch {
          continue;
        }
        // A file the workspace already had, holding no exported id, is no row of this export.
        if (row && ids.has(String(row.id))) decoded.push(row);
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
    // The same sanitized names the blob loop writes under, so verify reads back what was written.
    const refs = sanitizeBlobRefs(await source.listBlobs());
    out.blobs.db = refs.length;
    for (const item of refs) {
      const { ref } = item;
      const path = `assets/${item.bucket}/${item.path}`;
      if (item.unsafe) {
        errors.push(`blob ${path}: unsafe path`);
        continue;
      }
      // The original, or a conflict copy of it that holds the DB blob, passes the blob.
      const candidates = [path, ...files.filter((f) => conflictBasePath(f) === path)];
      const problems: string[] = [];
      let ok = false;
      for (const candidate of candidates) {
        const problem = await checkBlob(sink, candidate, ref.sizeBytes);
        if (problem === null) {
          ok = true;
          break;
        }
        problems.push(problem);
      }
      if (ok) out.blobs.verified++;
      else errors.push(`blob ${path}: ${problems[0] ?? "read failed"}`);
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
