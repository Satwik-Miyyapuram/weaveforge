import { localBackendParts } from "@/backend/providers/local/parts";
import { rustRepository } from "@/backend/providers/postgrest/rust-repository";
import { LOCAL_USER_ID } from "@weaveforge/core";

/** The Rust `showcase_seed.seed` result that the loader reads. */
export interface ShowcaseSeedResult {
  /** The id of the demo project the seed wrote. */
  projectId: string;
}

/** The Rust `showcase_seed` methods this loader calls. */
interface ShowcaseSeedRepo {
  chartKinds(): Promise<string[]>;
  seed(opts: { userId: string; charts: Record<string, string> }): Promise<
    ShowcaseSeedResult & {
      uploads: { bucket: string; path: string; base64: string }[];
    }
  >;
}

// --- fetch-showcase-chart ---
/**
 * One demo chart from the PNGs served with the app, or null to skip the
 * figure. Never rejects: a network error mid-seed only loses that figure,
 * instead of aborting the seed after the project row exists.
 */
export async function fetchShowcaseChart(
  kind: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Blob | null> {
  try {
    const res = await fetchImpl(`/showcase/${kind}.png`);
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// --- load-local-demo ---
/**
 * Fill the no-account copy with the demo thesis.
 *
 * Runs the Rust seeder against the local database, then writes the charts it
 * returns to the local blob store. The charts are served with the app
 * (apps/web/public/showcase), so this works offline once the app is installed.
 * The papers' PDFs are not bundled: the reader offers to fetch each from arXiv
 * on first open and keeps it after. Re-running replaces the earlier demo project.
 */
export async function loadLocalDemoWorkspace(): Promise<ShowcaseSeedResult> {
  const { db, blobStore } = localBackendParts();
  const repo = rustRepository<ShowcaseSeedRepo>(db, "showcase_seed", ["chartKinds", "seed"]);

  const charts: Record<string, string> = {};
  await Promise.all(
    (await repo.chartKinds()).map(async (kind) => {
      const blob = await fetchShowcaseChart(kind);
      if (blob) charts[kind] = await blobBase64(blob);
    }),
  );

  const { projectId, uploads } = await repo.seed({ userId: LOCAL_USER_ID, charts });
  for (const upload of uploads) {
    const bytes = Uint8Array.from(atob(upload.base64), (c) => c.charCodeAt(0));
    await blobStore.upload(upload.bucket, upload.path, new Blob([bytes], { type: "image/png" }), "image/png");
  }
  return { projectId };
}
