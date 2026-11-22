import type { KindCount, MigrationState } from "../domain/report";
import type { FileCodec, FileSink, Row, ServerSource } from "../domain/ports";
import { sha256Hex } from "../domain/hash";

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
      const want = expected.map(canon).sort();
      const got = decoded.map(canon).sort();
      if (want.length !== got.length || want.some((w, i) => w !== got[i])) {
        errors.push(`${kind}: decoded files differ from server rows`);
      }
    } catch (err) {
      errors.push(`${kind}: ${(err as Error).message}`);
    }
  }

  try {
    const refs = await source.listBlobs();
    out.blobs.db = refs.length;
    for (const ref of refs) {
      const path = `assets/${ref.bucket}/${ref.path}`;
      try {
        const bytes = await sink.readBytes(path);
        const sidecar = await sink.readText(`${path}.sha256`);
        if ((await sha256Hex(bytes)) === ref.sha256 && sidecar === ref.sha256) out.blobs.verified++;
        else errors.push(`blob ${path}: sha256 mismatch`);
      } catch (err) {
        errors.push(`blob ${path}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    errors.push(`blobs: ${(err as Error).message}`);
  }

  const kindsOk = kinds.every((k) => {
    const c = out.kinds[k];
    return c !== undefined && c.db === c.files;
  });
  out.state =
    errors.length === 0 && kindsOk && out.blobs.db === out.blobs.verified ? "verified" : "incomplete";
  return out;
}
