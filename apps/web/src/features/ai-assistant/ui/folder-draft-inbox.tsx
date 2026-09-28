"use client";

import { useEffect } from "react";
import { getContainer } from "@/bootstrap";
import { useProject } from "@/features/projects";
import {
  activeWorkspaceFs,
  onFolderConnected,
  onFolderDraftsChanged,
} from "@/features/workspace/application/workspace-folder";
import { importFolderDraftsOnce } from "../application/import-folder-drafts";

/**
 * Pull the local MCP's suggestions into the review queue.
 *
 * Proposals are stored per project, so this waits for both a project and a
 * connected folder, then runs again whenever the MCP writes a draft.
 */
export function FolderDraftInbox() {
  const projectId = useProject().current?.id ?? null;

  useEffect(() => {
    if (!projectId) return;
    const pull = () => {
      const fs = activeWorkspaceFs();
      if (!fs) return;
      void importFolderDraftsOnce(fs, (draft) =>
        getContainer().aiProposals.draftLocal({
          kind: draft.kind,
          resourceId: draft.resourceId,
          content: draft.content,
          payload: draft.payload,
          sourceLinks: draft.sourceLinks,
          expectedRevision: draft.expectedRevision,
        }),
      )
        .then((count) => {
          if (count > 0) window.dispatchEvent(new Event("ai-proposals-changed"));
        })
        .catch(() => undefined);
    };
    pull();
    const offConnected = onFolderConnected(pull);
    const offDrafts = onFolderDraftsChanged(pull);
    return () => {
      offConnected();
      offDrafts();
    };
  }, [projectId]);

  return null;
}
