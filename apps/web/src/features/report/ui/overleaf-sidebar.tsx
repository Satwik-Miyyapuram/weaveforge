"use client";

import { useEffect, useState } from "react";
import { getContainer } from "@/bootstrap";
import { listWorkshopProjects } from "@/features/overleaf/infrastructure/workshop-session-client";
import { isTauriShell } from "@/features/experiments/infrastructure/experiment-artifact-store";
import { useProject } from "@/features/projects";
import { loadOverleafTreeRows, type OverleafTreeRow } from "../lib/overleaf-tree-rows";
import { OverleafWorkspace } from "./overleaf-workspace";
import { browserPicksStore } from "./overleaf-project-picks";
import { linkedReportsGateway } from "./use-linked-reports";
import { browserClient, browserStore, canShowWorkshop } from "./use-workshop-session";

/** A workspace reload within this long reuses the last list rather than asking Overleaf again. */
const KEEP_MS = 60_000;
let kept: { key: string; at: number; rows: Promise<OverleafTreeRow[]> } | null = null;

/** The editor sidebar's Overleaf rows, for the open WeaveForge project. */
export async function overleafSidebarRows(): Promise<OverleafTreeRow[]> {
  const workshop = canShowWorkshop({ localMode: getContainer().auth.isLocalMode(), shell: isTauriShell() });
  const projectId = getContainer().projects.context.projectId ?? null;
  const sessionId = workshop ? browserStore.get() : null;
  const key = JSON.stringify([projectId, sessionId, browserPicksStore.get()]);
  if (kept && kept.key === key && Date.now() - kept.at < KEEP_MS) return kept.rows;
  const rows = loadOverleafTreeRows({
    workshop,
    projectId,
    sessionId: () => sessionId,
    listAccount: (id) => listWorkshopProjects(browserClient, id),
    listLinked: (id) => linkedReportsGateway.list(id),
    picked: () => browserPicksStore.get(),
  });
  kept = { key, at: Date.now(), rows };
  return rows;
}

/** One Overleaf project in an editor tab: its editor (or PDF), with no list around it. */
export function OverleafProjectTab({ overleafId }: { overleafId: string }) {
  const { current } = useProject();
  // Decided after mount, so the server render and first paint agree.
  const [workshop, setWorkshop] = useState<{ on: boolean; shell: boolean } | null>(null);
  useEffect(() => {
    const shell = isTauriShell();
    setWorkshop({ on: canShowWorkshop({ localMode: getContainer().auth.isLocalMode(), shell }), shell });
  }, []);
  if (!workshop) return null;
  return (
    <section className="screen report-overleaf-screen">
      <OverleafWorkspace
        workshop={workshop.on}
        inShell={workshop.shell}
        projectId={current?.id ?? null}
        onlyProjectId={overleafId}
        onExport={() => undefined}
      />
    </section>
  );
}
