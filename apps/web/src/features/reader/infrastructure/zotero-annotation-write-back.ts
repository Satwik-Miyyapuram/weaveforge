import {
  toZoteroWritePayload,
  type IZoteroAnnotationWriteBack,
  type ReaderAnnotation,
  type ZoteroAnnotationWritePayload,
} from "@thesis/core";
import type { ZoteroCredentialsProvider } from "@/features/papers/infrastructure/zotero-metadata-source";
import {
  zoteroHeaders,
  zoteroLibraryUrl,
} from "@/features/papers/infrastructure/zotero-web-api";

/**
 * Live Zotero annotation write-back (R5).
 *
 * Runs from the unlocked browser, like `ZoteroExporter` — the WeaveForge server
 * never sees the decrypted Zotero key or the write payload.
 *
 * Two safety properties are deliberate and load-bearing:
 *
 * 1. **Dry-run by default.** `push` builds payloads and returns without calling
 *    Zotero unless the caller passes `{ live: true }`. Mutating someone's real
 *    library is not something to do as a side effect of opening a screen.
 * 2. **Never blind-overwrite.** Updates carry `If-Unmodified-Since-Version`, so
 *    a row edited in Zotero desktop since we last synced comes back 412 and is
 *    reported as a conflict rather than silently clobbered. Resolution is the
 *    caller's job, via `decideAnnotationSync` / `resolveAnnotationConflict`.
 */

export interface ZoteroAnnotationWriteResult {
  /** Local annotation id. */
  id: string;
  outcome: "created" | "updated" | "conflict" | "failed";
  /** Zotero item key, once known. */
  zoteroKey?: string;
  /** Library version after the write — store as `zotero_version`. */
  zoteroVersion?: number;
  reason?: string;
}

export interface ZoteroAnnotationPushResult {
  dryRun: boolean;
  payloads: ZoteroAnnotationWritePayload[];
  results: ZoteroAnnotationWriteResult[];
}

interface ZoteroWriteResponse {
  successful?: Record<string, { key?: string; version?: number }>;
  failed?: Record<string, { code?: number; message?: string }>;
  unchanged?: Record<string, unknown>;
}

export class ZoteroApiAnnotationWriteBack implements IZoteroAnnotationWriteBack {
  constructor(
    private readonly credentials: ZoteroCredentialsProvider = async () => ({}),
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly apiOrigin = "https://api.zotero.org",
  ) {}

  /**
   * `parentItemKey` is the **attachment** key (the stored PDF), not the
   * top-level bibliographic item — Zotero anchors annotations to the file they
   * were drawn on. Passing the parent item makes Zotero reject the write.
   */
  async push(
    parentItemKey: string,
    annotations: readonly ReaderAnnotation[],
    options?: { live?: boolean },
  ): Promise<ZoteroAnnotationPushResult> {
    const payloads = annotations.map((a) => toZoteroWritePayload(a, parentItemKey));
    if (!options?.live) {
      return { dryRun: true, payloads, results: [] };
    }

    const creds = await this.credentials();
    if (!creds.apiKey || !creds.library) {
      throw new Error("Zotero is not configured. Add your API key and library in Settings.");
    }
    if (!parentItemKey.trim()) {
      throw new Error("A Zotero attachment key is required to write annotations.");
    }

    const base = zoteroLibraryUrl(creds.library, this.apiOrigin);
    const results: ZoteroAnnotationWriteResult[] = [];

    // New annotations are created together; existing ones are versioned
    // individually, so they must be sent one at a time to carry their own
    // If-Unmodified-Since-Version.
    const creates: { ann: ReaderAnnotation; payload: ZoteroAnnotationWritePayload }[] = [];
    for (const [i, ann] of annotations.entries()) {
      const payload = payloads[i]!;
      if (ann.zoteroKey) {
        results.push(await this.update(base, creds.apiKey, ann, payload));
      } else {
        creates.push({ ann, payload });
      }
    }
    if (creates.length > 0) {
      results.push(...(await this.create(base, creds.apiKey, creates)));
    }

    return { dryRun: false, payloads, results };
  }

  private async create(
    base: string,
    apiKey: string,
    items: { ann: ReaderAnnotation; payload: ZoteroAnnotationWritePayload }[],
  ): Promise<ZoteroAnnotationWriteResult[]> {
    const res = await this.fetchFn(`${base}/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...zoteroHeaders(apiKey),
        // Makes the create idempotent if the request is retried after a
        // timeout, so a flaky connection cannot duplicate every highlight.
        "Zotero-Write-Token": writeToken(),
      },
      body: JSON.stringify(items.map((i) => i.payload)),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const reason = `Zotero create failed (${res.status}). ${detail}`.trim();
      return items.map(({ ann }) => ({ id: ann.id, outcome: "failed" as const, reason }));
    }

    const body = (await res.json().catch(() => ({}))) as ZoteroWriteResponse;
    const libraryVersion = versionHeader(res);
    return items.map(({ ann }, index) => {
      const key = String(index);
      const ok = body.successful?.[key];
      if (ok?.key) {
        return {
          id: ann.id,
          outcome: "created" as const,
          zoteroKey: ok.key,
          ...(ok.version ?? libraryVersion ? { zoteroVersion: ok.version ?? libraryVersion! } : {}),
        };
      }
      const bad = body.failed?.[key];
      return {
        id: ann.id,
        outcome: "failed" as const,
        reason: bad?.message ?? "Zotero did not report this annotation as written.",
      };
    });
  }

  private async update(
    base: string,
    apiKey: string,
    ann: ReaderAnnotation,
    payload: ZoteroAnnotationWritePayload,
  ): Promise<ZoteroAnnotationWriteResult> {
    const url = `${base}/items/${encodeURIComponent(ann.zoteroKey!)}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...zoteroHeaders(apiKey),
    };
    if (typeof ann.zoteroVersion === "number") {
      headers["If-Unmodified-Since-Version"] = String(ann.zoteroVersion);
    }

    const res = await this.fetchFn(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify(payload),
    });

    // 412 is Zotero telling us the item moved on since we last read it.
    if (res.status === 412) {
      return {
        id: ann.id,
        outcome: "conflict",
        zoteroKey: ann.zoteroKey!,
        reason: "The annotation changed in Zotero since this copy was synced.",
      };
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        id: ann.id,
        outcome: "failed",
        zoteroKey: ann.zoteroKey!,
        reason: `Zotero update failed (${res.status}). ${detail}`.trim(),
      };
    }
    const version = versionHeader(res);
    return {
      id: ann.id,
      outcome: "updated",
      zoteroKey: ann.zoteroKey!,
      ...(version ? { zoteroVersion: version } : {}),
    };
  }
}

function versionHeader(res: Response): number | undefined {
  const raw = res.headers?.get?.("Last-Modified-Version");
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function writeToken(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid.replace(/-/g, "");
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 32);
}
