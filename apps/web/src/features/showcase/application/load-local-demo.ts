import { localBackendParts } from "@/backend/providers/local/wire-local-backend";
import { LOCAL_USER_ID } from "@weaveforge/core";
import { seedShowcase, type SeedShowcaseResult } from "../infrastructure/seed-showcase";

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

// --- load-local-demo ---
/**
 * Fill the no-account copy with the demo thesis.
 *
 * Runs the shared seeder against the local database and blob store. The
 * charts are served with the app (apps/web/public/showcase), so this works
 * offline once the app is installed. The papers' PDFs are not bundled: the
 * reader offers to fetch each from arXiv on first open and keeps it after.
 * Re-running replaces the earlier demo project.
 */
export async function loadLocalDemoWorkspace(): Promise<SeedShowcaseResult> {
  const { db, blobStore } = localBackendParts();
  return seedShowcase({
    db,
    userId: LOCAL_USER_ID,
    store: blobStore,
    chart: (kind) => fetchShowcaseChart(kind),
  });
}
