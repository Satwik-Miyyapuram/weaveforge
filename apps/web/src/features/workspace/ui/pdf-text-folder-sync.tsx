"use client";

import { useEffect } from "react";
import { useProject } from "@/features/projects";
import { activeWorkspaceFs, onFolderConnected } from "@/features/workspace/application/workspace-folder";
import { logToApp } from "@/lib/error-report/app-log";

/**
 * Keep the folder's copy of extracted PDF text level with IndexedDB's.
 *
 * The copy is per project, and at launch the two things it needs arrive in no
 * fixed order: `WorkspaceFolderRestore` reconnects the remembered folder above
 * the project provider, usually before the stored project is applied. A
 * listener that only waited for the folder read a null project and reconciled
 * nothing (15 papers stored, 1 file in the folder). So this runs once both are
 * known, whichever lands second, and again on a project switch.
 *
 * `pdf-text-folder` is imported lazily: it sits in the search chunks, which
 * load with the index, not with the shell.
 */
export function PdfTextFolderSync() {
  const projectId = useProject().current?.id ?? null;

  useEffect(() => {
    if (!projectId) return;
    const reconcile = () => {
      void import("@/features/search/application/pdf-text-folder")
        .then(({ reconcilePdfTextFolder }) => reconcilePdfTextFolder(projectId))
        .catch((err: unknown) =>
          logToApp({
            level: "warn",
            source: "workspace",
            message: "The PDF text folder could not be reconciled",
            detail: err instanceof Error ? err.message : String(err),
          }),
        );
    };
    if (activeWorkspaceFs()) reconcile();
    return onFolderConnected(reconcile);
  }, [projectId]);

  return null;
}
