"use client";

import type { LatexSectionTree } from "@weaveforge/wasm";

/**
 * The Overleaf link, for a copy working on this computer with no account.
 *
 * 0.9.8 has no local database and the desktop copy ships no server, so there is
 * nowhere to keep link rows or the token. Overleaf is a server feature: every
 * operation here (all 4 of them) refuses with the same copy the rest of the app
 * uses for account-only features.
 */

export const OVERLEAF_NEEDS_ACCOUNT = "Overleaf needs an account.";

export interface OverleafReportRow {
  id: string;
  project_id: string;
  title: string;
  connection_id: string;
  overleaf_project_id: string;
  entry_file: string;
  external_url: string | null;
  last_fetched_at: string | null;
  section_targets: Record<string, number>;
}

function refuse(): Promise<never> {
  return Promise.reject(new Error(OVERLEAF_NEEDS_ACCOUNT));
}

export class LocalOverleafGateway {
  listReports(_projectId: string): Promise<OverleafReportRow[]> {
    return refuse();
  }

  patchReport(_input: { id: string; title?: string; overleafProjectId?: string; entryFile?: string; sectionTargets?: unknown }): Promise<void> {
    return refuse();
  }

  deleteReport(_id: string): Promise<void> {
    return refuse();
  }

  readContent(_report: OverleafReportRow): Promise<{
    files: { path: string; content: string }[];
    entryFile: string;
    sectionTree: LatexSectionTree;
    overleafUrl: string;
  }> {
    return refuse();
  }
}
