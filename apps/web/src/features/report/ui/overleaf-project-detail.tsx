"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { BackButton } from "@/components/back-button";
import { Button } from "@/components/button";
import { OpenIcon } from "@/components/view-icons";
import { ViewSwitch } from "@/components/view-switch";
import type { WorkshopClientDeps } from "@/features/overleaf/infrastructure/workshop-session-client";
import type { OverleafProjectRow } from "../lib/overleaf-project-list";
import type { LinkedReport } from "./linked-overleaf-api";
import { EditOverleafReportForm, LinkOverleafForm } from "./overleaf-report-forms";
import type { WorkshopSession } from "./use-workshop-session";
import { WorkshopPdfViewer } from "./workshop-pdf-viewer";

/** The editor pulls in CodeMirror; load it only when the Write tab opens. */
const WorkshopLiveEditor = dynamic(() => import("./workshop-live-editor").then((m) => m.WorkshopLiveEditor), { ssr: false });

export type DetailTab = "write" | "pdf";

/** What each tab needs, and the one line shown when it is missing. Null means the tab works. */
export function tabBlockers({ signedIn, inAccount, inShell }: {
  signedIn: boolean;
  inAccount: boolean;
  inShell: boolean;
}): Record<DetailTab, string | null> {
  const live = !signedIn
    ? "Sign in to Overleaf above to use this."
    : !inAccount
      ? "This project is not in the signed-in Overleaf account."
      : null;
  return {
    write: !inShell ? "Live editing needs the WeaveForge desktop app." : live,
    pdf: live,
  };
}

const TABS: readonly { value: DetailTab; label: string; title: string }[] = [
  { value: "write", label: "Write", title: "Edit the files here; edits reach Overleaf as you type" },
  { value: "pdf", label: "PDF", title: "The PDF Overleaf compiles from the project's main document" },
];

/** One Overleaf project: Write and PDF tabs, and its link to this WeaveForge project. */
export function OverleafProjectDetail({
  row,
  session,
  client,
  inShell,
  canEditAsFiles,
  projectId,
  onUnlink,
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
  onUnlink: (report: LinkedReport) => Promise<boolean>;
  onLinksChanged: () => void;
  onError: (message: string) => void;
  onBack: () => void;
}) {
  const report = row.report;
  const sessionId = session.sessionId;
  const blockers = tabBlockers({ signedIn: Boolean(sessionId), inAccount: row.inAccount, inShell });
  const [tab, setTab] = useState<DetailTab>(() => TABS.find((t) => blockers[t.value] === null)?.value ?? "write");
  const [form, setForm] = useState<"link" | "edit" | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  const blocker = blockers[tab];
  const overleafUrl = report?.external_url ?? `https://www.overleaf.com/project/${encodeURIComponent(row.id)}`;
  const meta = [
    row.inAccount ? "In your Overleaf account" : "Not in the signed-in account",
    ...(report ? [`Linked to this project`, report.entry_file] : []),
  ];

  return (
    <article className="record overleaf-detail">
      <nav className="record-bar" aria-label="Overleaf project">
        <BackButton label="Overleaf" onClick={onBack} />
        <span className="record-mono record-bar-id">Project {row.id.slice(0, 6)}</span>
        <ViewSwitch
          label="Project view"
          value={tab}
          onChange={setTab}
          options={TABS.map((t) => ({ ...t, title: blockers[t.value] ?? t.title }))}
        />
        <div className="record-actions">
          <Button variant="ghost" size="sm" href={overleafUrl} target="_blank" rel="noreferrer" title="Open in Overleaf">
            <OpenIcon />
            <span>Open in Overleaf</span>
          </Button>
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
              title="Link with a Git token, so it shows here as ★ even when you are not signed in"
              onClick={() => setForm(form === "link" ? null : "link")}
            >
              {form === "link" ? "Cancel" : "Link to this project"}
            </Button>
          ) : null}
        </div>
      </nav>
      <header className="record-head overleaf-detail__head">
        <h1 className="record-title">{report && <span className="overleaf-star" title="Linked to this WeaveForge project">★ </span>}{row.name}</h1>
        <p className="record-mono record-meta">{meta.join(" / ")}</p>
      </header>
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
        ) : sessionId ? (
          <WorkshopPdfViewer sessionId={sessionId} projectId={row.id} authHeaders={client.authHeaders} />
        ) : null}
      </div>
    </article>
  );
}
