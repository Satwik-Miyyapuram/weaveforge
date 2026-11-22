import { createHash } from "node:crypto";
import { test } from "node:test";
import type { BlobRef, FileCodec, Row, ServerSource } from "../../domain/ports";
import type { KindWriter } from "../../domain/kind-writer";
import { PostgrestSource } from "../../infrastructure/postgrest-source";

export const NOW = "2026-11-22T00:00:00.000Z";
export const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

// Fake codec: one JSON file per row at <kind>/<id>.json. Only `supported` kinds have a codec.
export function fakeCodec(supported: string[]): FileCodec {
  return {
    supports: (kind) => supported.includes(kind),
    toFile: (kind, row) => ({ path: `${kind}/${String(row.id)}.json`, text: JSON.stringify(row) }),
    toRow: (kind, path, text) => (path.startsWith(`${kind}/`) ? (JSON.parse(text) as Row) : null),
  };
}

// Fake PostgREST: rows per kind and blobs. `failKind` throws on list, simulating an interrupted run.
export function fakeServer(opts: {
  rows: Record<string, Row[]>;
  blobs?: { ref: BlobRef; bytes: Uint8Array }[];
  failKind?: string;
  rawCounts?: Record<string, number>;
  outbox?: number;
  undecryptable?: Record<string, number>;
  trashed?: Record<string, Row[]>;
  secretProviders?: () => Promise<string[]>;
}) {
  const calls: string[] = [];
  const source: ServerSource = {
    listRows: async (kind) => {
      calls.push(`list:${kind}`);
      if (kind === opts.failKind) throw new Error("connection reset");
      return opts.rows[kind] ?? [];
    },
    secretProviders: opts.secretProviders ?? (async () => []),
    countRows: async (kind) => {
      calls.push(`count:${kind}`);
      return opts.rawCounts?.[kind] ?? (opts.rows[kind] ?? []).length;
    },
    pendingOutbox: async () => opts.outbox ?? 0,
    listTrashed: async (kind) => {
      calls.push(`trash:${kind}`);
      return opts.trashed?.[kind] ?? [];
    },
    undecryptable: async (kind) => opts.undecryptable?.[kind] ?? 0,
    listBlobs: async () => (opts.blobs ?? []).map((b) => b.ref),
    fetchBlob: async (ref) => {
      calls.push(`blob:${ref.path}`);
      const hit = (opts.blobs ?? []).find((b) => b.ref.path === ref.path);
      if (!hit) throw new Error("no such blob");
      return hit.bytes;
    },
    markExported097: async () => {
      calls.push("mark:097");
    },
  };
  return { source, calls };
}

export const FIXTURE: Record<string, Row[]> = {
  logEntries: [
    { id: "l1", text: "first" },
    { id: "l2", text: "second  " },
  ],
  experiments: [{ id: "e1", name: "Exp", n: 3, tags: ["x"] }],
};
export const KINDS = ["logEntries", "experiments"];
export const SUPPORTED = ["logEntries", "experiments"];

// PostgREST counts for the secret tables: `totals` maps the table name to its row count.
export function secretProvidersFor(totals: Record<string, number>): () => Promise<string[]> {
  const fetch = (async (url: string) => {
    const table = new URL(url).pathname.split("/").pop() ?? "";
    return new Response(null, { status: 200, headers: { "content-range": `0-0/${totals[table] ?? 0}` } });
  }) as unknown as typeof globalThis.fetch;
  return () =>
    new PostgrestSource({ baseUrl: "https://api.example.test", userId: "u1", headers: {}, fetch: fetch }).secretProviders();
}

/** A blobs writer (group c shape): the blob loop feeds it, so the kind itself is never listed row by row. */
export const BLOB_WRITER: KindWriter = { kinds: ["blobs"], write: async () => {}, readBack: async () => [] };

/** Codec that writes every column except `dropped`, as a file that lacks server-only columns would. */
export function codecDropping(kinds: string[], dropped: string[]): FileCodec {
  const base = fakeCodec(kinds);
  return {
    ...base,
    toFile: (kind, row) => ({
      path: `${kind}/${String(row.id)}.json`,
      text: JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => !dropped.includes(k)))),
    }),
  };
}

// Desktop contract: backup before any export read or write; mark-exported only when verified.
export function fakeDesktop(calls: string[], opts: { backupFails?: boolean; deviceId?: string; markFails?: boolean; dump?: string } = {}) {
  return {
    backup: async (folder: string) => {
      calls.push(`backup:${folder}`);
      if (opts.backupFails) throw new Error("disk full writing pre-migration.dump");
      return { deviceId: opts.deviceId ?? "dev-42", dump: opts.dump ?? "pre-migration-097.dump" };
    },
    markExported: async (folder: string) => {
      calls.push(`desktop-mark:${folder}`);
      if (opts.markFails) throw new Error("shell refused");
    },
  };
}

// In-memory KindWriter: write keeps rows, readBack returns them. Never touches the codec.
export function memoryWriter(kind: string, opts: { dropOnReadBack?: boolean } = {}) {
  const stored: Row[] = [];
  const writer: KindWriter = {
    kinds: [kind],
    write: async (_k, row) => {
      stored.push(JSON.parse(JSON.stringify(row)) as Row);
    },
    readBack: async () => (opts.dropOnReadBack ? stored.slice(1) : stored.slice()),
  };
  return { writer, stored };
}

export const TRASH_ROW = { id: "t1", body: "gone", deleted_at: "2026-11-01T00:00:00.000Z" };
export const TRASH_PATH = ".weaveforge/migration-0.9.7/trash/logEntries/t1.json";
