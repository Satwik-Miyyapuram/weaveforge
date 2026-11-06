"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/button";
import { ViewSwitch } from "@/components/view-switch";
import { loadLiveOutline, type LiveOutline } from "@/features/overleaf/application/live-outline";
import type { WorkshopClientDeps } from "@/features/overleaf/infrastructure/workshop-session-client";
import type { OverleafProjectRow } from "../lib/overleaf-project-list";
import type { LinkedReport } from "./linked-overleaf-api";
import { OverleafOutline } from "./overleaf-outline";
import { EditOverleafReportForm, LinkOverleafForm } from "./overleaf-report-forms";
import type { LinkedReportsGateway } from "./use-linked-reports";
import type { WorkshopSession } from "./use-workshop-session";
import { WorkshopPdfViewer } from "./workshop-pdf-viewer";

/** The editor pulls in CodeMirror; load it only when the Write tab opens. */
const WorkshopLiveEditor = dynamic(() => import("./workshop-live-editor").then((m) => m.WorkshopLiveEditor), { ssr: false });

export type DetailTab = "write" | "pdf" | "outline";

/** What each tab needs, and the one line shown when it is missing. Null means the tab works. */
export function tabBlockers({ signedIn, inAccount, inShell, linked }: {
  signedIn: boolean;
  inAccount: boolean;
  inShell: boolean;
  linked: boolean;
}): Record<DetailTab, string | null> {
  const live = !signedIn
    ? "Sign in to Overleaf above to use this."
    : !inAccount
      ? "This project is not in the signed-in Overleaf account."
      : null;
  return {
    write: !inShell ? "Live editing needs the WeaveForge desktop app." : live,
    pdf: live,
    outline: signedIn && inAccount ? null : linked ? null : "Sign in to Overleaf, or link this project with a Git token, to see its outline.",
  };
}

const TABS: readonly { value: DetailTab; label: string; title: string }[] = [
  { value: "write", label: "Write", title: "Edit the files here; edits reach Overleaf as you type" },
  { value: "pdf", label: "PDF", title: "The PDF Overleaf compiles from the project's main document" },
  { value: "outline", label: "Outline", title: "Sections, word counts, targets and checks" },
];

/** One Overleaf project: Write, PDF and Outline tabs, and its link to this WeaveForge project. */
export function OverleafProjectDetail({
  row,
  session,
  client,
  inShell,
  canEditAsFiles,
  projectId,
  gateway,
  onUnlink,
  onSaveTargets,
  onLinksChanged,
  onError,
  onBack,
}: {
  row: OverleafProjectRow;
  session: WorkshopSession;
  client: WorkshopClientDeps;
  inShell: boolean;
  canEditAsFiles: boolean;
  /** The open WeaveForge project; null hides linking. */
  projectId: string | null;
  gateway: LinkedReportsGateway;
  onUnlink: (report: LinkedReport) => Promise<boolean>;
  onSaveTargets: (report: LinkedReport, targets: Record<string, number>) => Promise<boolean>;
  onLinksChanged: () => void;
  onError: (message: string) => void;
  onBack: () => void;
}) {
  const report = row.report;
  const sessionId = session.sessionId;
  const live = Boolean(sessionId) && row.inAccount;
  const blockers = tabBlockers({ signedIn: Boolean(sessionId), inAccount: row.inAccount, inShell, linked: Boolean(report) });
  const [tab, setTab] = useState<DetailTab>(() => TABS.find((t) => blockers[t.value] === null)?.value ?? "outline");
  const [form, setForm] = useState<"link" | "edit" | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  // The outline reload depends on ids only: a new session object or a saved
  // target must not read the whole project again.
  const latest = useRef({ session, report });
  latest.current = { session, report };
  const reportId = report?.id ?? null;
  const loadOutline = useCallback(async (): Promise<LiveOutline> => {
    if (live && sessionId) {
      const result = await loadLiveOutline(client, sessionId, row.id);
      if (result.ok) return result.content;
      if (result.expired) latest.current.session.expire(result.message);
      throw new Error(result.message);
    }
    const linked = latest.current.report;
    if (!linked) throw new Error("This project is not linked.");
    const content = await gateway.readContent(linked);
    return { files: content.files, entryFile: content.entryFile, sectionTree: content.sectionTree };
  }, [live, sessionId, client, row.id, gateway, reportId]);

  const blocker = blockers[tab];
  const overleafUrl = report?.external_url ?? `https://www.overleaf.com/project/${encodeURIComponent(row.id)}`;

  return (
    <div className="overleaf-detail">
      <div className="overleaf-detail__head">
        <Button variant="ghost" size="sm" onClick={onBack}>← All projects</Button>
        <h2>{report && <span className="overleaf-star" title="Linked to this WeaveForge project">★ </span>}{row.name}</h2>
        <div className="overleaf-detail__actions">
          <Button variant="link" href={overleafUrl} target="_blank" rel="noreferrer">Open in Overleaf ↗</Button>
          {report ? (
            confirmUnlink ? (
              <>
                <span className="muted">Remove the link? Overleaf keeps the project.</span>
                <Button variant="ghost" size="sm" onClick={() => void onUnlink(report).then((ok) => ok && setConfirmUnlink(false))}>Confirm</Button>
                <Button variant="cancel" size="sm" onClick={() => setConfirmUnlink(false)}>Cancel</Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => setForm(form === "edit" ? null : "edit")}>Edit link</Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmUnlink(true)}>Unlink</Button>
              </>
            )
          ) : projectId ? (
            <Button
              variant="ghost"
              size="sm"
              title="Link with a Git token to keep word targets and read the outline without signing in"
              onClick={() => setForm(form === "link" ? null : "link")}
            >
              {form === "link" ? "Cancel" : "Link to this project"}
            </Button>
          ) : null}
        </div>
      </div>
      {form === "edit" && report && (
        <EditOverleafReportForm
          report={report}
          onSaved={() => { setForm(null); onLinksChanged(); }}
          onCancel={() => setForm(null)}
          onError={onError}
        />
      )}
      {form === "link" && projectId && (
        <LinkOverleafForm
          projectId={projectId}
          defaults={{ title: row.name, overleafProjectId: row.id }}
          onLinked={() => { setForm(null); onLinksChanged(); }}
          onError={onError}
        />
      )}
      <ViewSwitch
        label="Project view"
        value={tab}
        onChange={setTab}
        options={TABS.map((t) => ({ ...t, title: blockers[t.value] ?? t.title }))}
      />
      <div className="overleaf-detail__body" role="tabpanel">
        {blocker ? (
          <div className="overleaf-detail__blocked">
            <p className="muted">{blocker}</p>
            {tab === "write" && canEditAsFiles && (
              <Button variant="link" href="/settings#settings-workspace">Edit as files with a Git token (Settings)</Button>
            )}
          </div>
        ) : tab === "write" && sessionId ? (
          <WorkshopLiveEditor
            key={`${sessionId}:${row.id}`}
            client={client}
            sessionId={sessionId}
            projectId={row.id}
            onClose={() => setTab("pdf")}
          />
        ) : tab === "pdf" && sessionId ? (
          <WorkshopPdfViewer sessionId={sessionId} projectId={row.id} authHeaders={client.authHeaders} />
        ) : (
          <OverleafOutline
            key={live ? "live" : "git"}
            load={loadOutline}
            source={live ? "Live text from Overleaf." : `From the Git link (${report?.entry_file ?? "main.tex"}).`}
            targets={report ? { initial: report.section_targets ?? {}, save: (next) => onSaveTargets(report, next) } : null}
          />
        )}
      </div>
    </div>
  );
}
