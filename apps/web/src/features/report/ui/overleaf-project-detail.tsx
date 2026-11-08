"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { BackButton } from "@/components/back-button";
import { Button } from "@/components/button";
import { LinkIcon, OpenIcon } from "@/components/view-icons";
import { useFoldNav } from "@/lib/hooks/use-nav-fold";
import type { WorkshopClientDeps } from "@/features/overleaf/infrastructure/workshop-session-client";
import type { OverleafProjectRow } from "../lib/overleaf-project-list";
import type { LinkedReport } from "./linked-overleaf-api";
import { EditOverleafReportForm, LinkOverleafForm } from "./overleaf-report-forms";
import type { WorkshopSession } from "./use-workshop-session";
import { WorkshopPdfViewer } from "./workshop-pdf-viewer";

/** The editor pulls in CodeMirror; load it only when a project opens in the desktop app. */
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

/**
 * One Overleaf project as Overleaf lays it out: files, editor and PDF, with our
 * record header and its link to this WeaveForge project. Without the desktop app
 * it shows the PDF alone.
 */
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
  /** Back to the project list; absent when the project is opened on its own. */
  onBack?: () => void;
}) {
  const report = row.report;
  const sessionId = session.sessionId;
  const blockers = tabBlockers({ signedIn: Boolean(sessionId), inAccount: row.inAccount, inShell });
  const [form, setForm] = useState<"link" | "edit" | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  // A ref, not state, so a second click before the re-render cannot start another delete.
  const unlinkBusy = useRef(false);
  async function confirmUnlinkOnce() {
    if (unlinkBusy.current) return;
    unlinkBusy.current = true;
    setUnlinking(true);
    try {
      const ok = await onUnlink(report!);
      if (ok) setConfirmUnlink(false);
    } finally {
      unlinkBusy.current = false;
      setUnlinking(false);
    }
  }

  const canWrite = blockers.write === null && Boolean(sessionId);
  const overleafUrl = report?.external_url ?? `https://www.overleaf.com/project/${encodeURIComponent(row.id)}`;
  const meta = [
    row.inAccount ? "In your Overleaf account" : "Not in the signed-in account",
    ...(report ? [`Linked to this project`, report.entry_file] : []),
  ];

  const live = canWrite && sessionId;
  // The editor needs the width: the app nav folds to its rail while it is open.
  useFoldNav(Boolean(live));
  // Open in Overleaf and the link controls; in the live editor they sit in Overleaf's toolbar.
  const actions = (
    <>
      <Button variant="ghost" size="sm" href={overleafUrl} target="_blank" rel="noreferrer" title="Open in Overleaf" aria-label="Open in Overleaf">
        <OpenIcon />
      </Button>
      {report ? (
        confirmUnlink ? (
          <>
            <span className="muted">Remove the link? Overleaf keeps the project.</span>
            <Button variant="ghost" size="sm" disabled={unlinking} onClick={() => void confirmUnlinkOnce()}>Confirm</Button>
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
          aria-label={form === "link" ? undefined : "Link to this project"}
          onClick={() => setForm(form === "link" ? null : "link")}
        >
          {form === "link" ? "Cancel" : <LinkIcon />}
        </Button>
      ) : null}
    </>
  );

  return (
    <article className={live ? "record overleaf-detail overleaf-detail--ide" : "record overleaf-detail"}>
      {/* The live editor is the whole page, as on Overleaf: its home button goes back. */}
      {!live && (
        <>
          <nav className="record-bar" aria-label="Overleaf project">
            {onBack && <BackButton label="Overleaf" onClick={onBack} />}
            <span className="record-mono record-bar-id">Project {row.id.slice(0, 6)}</span>
            <div className="record-actions">{actions}</div>
          </nav>
          <header className="record-head overleaf-detail__head">
            <h1 className="record-title">{report && <span className="overleaf-star" title="Linked to this WeaveForge project">★ </span>}{row.name}</h1>
            <p className="record-mono record-meta">{meta.join(" / ")}</p>
          </header>
        </>
      )}
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
      <div className="overleaf-detail__body">
        {live ? (
          <WorkshopLiveEditor
            key={`${sessionId}:${row.id}`}
            client={client}
            sessionId={sessionId}
            projectId={row.id}
            toolbar={actions}
            onHome={onBack ?? (() => undefined)}
          />
        ) : (
          <>
            <div className="overleaf-detail__blocked">
              <p className="muted">{blockers.pdf ?? blockers.write}</p>
              {blockers.pdf === null && canEditAsFiles && (
                <Button variant="link" href="/settings#settings-workspace">Edit as files with a Git token (Settings)</Button>
              )}
            </div>
            {blockers.pdf === null && sessionId && (
              <WorkshopPdfViewer key={`${sessionId}:${row.id}`} sessionId={sessionId} projectId={row.id} authHeaders={client.authHeaders} />
            )}
          </>
        )}
      </div>
    </article>
  );
}
