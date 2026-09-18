import { LOCAL_USER_ID } from "@weaveforge/core";
import { localBackendParts } from "@/backend/providers/local/wire-local-backend";
import { seedShowcase, type SeedShowcaseResult } from "../infrastructure/seed-showcase";

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
    chart: async (kind) => {
      const res = await fetch(`/showcase/${kind}.png`);
      if (!res.ok) return null;
      return res.blob();
    },
  });
}
