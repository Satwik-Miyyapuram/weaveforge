"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { RowButton } from "@/components/controls";
import { FormError } from "@/components/form-error";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { overleafSyncAvailable } from "@/features/overleaf/application/overleaf-folder-sync";
import type { WorkshopClientDeps } from "@/features/overleaf/infrastructure/workshop-session-client";
import {
  filterOverleafProjects,
  mergeOverleafProjects,
  pickedOverleafProjects,
  type OverleafProjectRow,
} from "../lib/overleaf-project-list";
import { local } from "./linked-overleaf-api";
import { OverleafConnect } from "./overleaf-connect";
import { OverleafProjectDetail } from "./overleaf-project-detail";
import { browserPicksStore, type ProjectPicksStore } from "./overleaf-project-picks";
import { LinkOverleafForm } from "./overleaf-report-forms";
import { OverleafSettings } from "./overleaf-settings";
import { linkedReportsGateway, useLinkedReports, type LinkedReportsGateway } from "./use-linked-reports";
import { browserClient, browserStore, useWorkshopSession, type WorkshopSessionStore } from "./use-workshop-session";

function rowMeta(row: OverleafProjectRow, signedIn: boolean): string {
  if (!row.report) return "In your Overleaf account";
  const parts = ["Linked", row.report.entry_file];
  if (signedIn && !row.inAccount) parts.push("not in the signed-in account");
  return parts.join(" · ");
}

/**
 * The Overleaf tab: connect once, then one list of projects (the signed-in
 * account's, plus the ones linked to this WeaveForge project with a Git token,
 * marked ★). Opening one shows Write, PDF and Outline.
 *
 * The sign-in cookie is sent once and kept by the routes (sealed on the server,
 * or in this device's keychain when `inShell`); this screen holds only the
 * session id. `workshop` false (a browser copy with no account) hides sign-in.
 */
export function OverleafWorkspace({
  client = browserClient,
  store = browserStore,
  inShell = false,
  signInWindow = desktop()?.overleafSignIn,
  canEditAsFiles = overleafSyncAvailable(),
  workshop,
  projectId,
  gateway = linkedReportsGateway,
  picks = browserPicksStore,
  onExport,
}: {
  client?: WorkshopClientDeps;
  store?: WorkshopSessionStore;
  inShell?: boolean;
  /** Opens Overleaf's own sign-in in an app window; answers a session id, or null if closed. */
  signInWindow?: () => Promise<string | null>;
  /** Git pull/push into the vault is available (desktop app only). */
  canEditAsFiles?: boolean;
  /** Sign-in routes exist (see `canShowWorkshop`). */
  workshop: boolean;
  /** The open WeaveForge project; links and word targets belong to it. */
  projectId: string | null;
  gateway?: LinkedReportsGateway;
  /** Remembers which account projects the list shows. */
  picks?: ProjectPicksStore;
  /** Opens the ZIP export, to start a new Overleaf project from this one. */
  onExport: () => void;
}) {
  const session = useWorkshopSession({ client, store, signInWindow, enabled: workshop });
  const linked = useLinkedReports(projectId, gateway);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string> | null>(() => {
    const ids = picks.get();
    return ids ? new Set(ids) : null;
  });
  const pick = (next: Set<string> | null) => {
    setPicked(next);
    picks.set(next ? [...next] : null);
  };

  const rows = mergeOverleafProjects(session.projects, linked.reports);
  const visible = pickedOverleafProjects(rows, picked);
  const shown = filterOverleafProjects(visible, query);
  const open = rows.find((row) => row.id === openId) ?? null;
  const signedIn = Boolean(session.sessionId);
  const loading = signedIn && session.projects === null && !session.loadFailed;
  const error = [session.error, linked.error].filter(Boolean).join(" ");

  const settingsButton = signedIn && (
    <Button size="sm" variant="ghost" title="Overleaf account, and which projects show" onClick={() => setSettingsOpen((v) => !v)}>
      {settingsOpen ? "Close settings" : "Settings"}
    </Button>
  );
  const settings = signedIn && settingsOpen && (
    <OverleafSettings
      session={session}
      accountRows={rows.filter((row) => row.inAccount && !row.report)}
      picked={picked}
      onPick={pick}
      onClose={() => setSettingsOpen(false)}
    />
  );

  const connect = workshop && !signedIn && (
    <OverleafConnect session={session} hasSignInWindow={Boolean(signInWindow)} inShell={inShell} canEditAsFiles={canEditAsFiles} />
  );

  const linkForm = linkOpen && projectId && (
    <>
      <p className="linked-overleaf-disclosure">
        {local()
          ? "With a Git link, this app fetches the LaTeX source from Overleaf with the token kept in your computer's keychain. Nothing goes through a server of ours."
          : "With a Git link, WeaveForge's server fetches the LaTeX source from Overleaf with your token."}
        {" "}The source stays in Overleaf and is not stored as WeaveForge project data.
      </p>
      <LinkOverleafForm
        projectId={projectId}
        onLinked={() => { setLinkOpen(false); void linked.reload(); }}
        onError={linked.setError}
      />
    </>
  );

  return (
    <section className="overleaf-workspace" aria-label="Overleaf projects">
      {error && <FormError>{error}</FormError>}
      {session.loadFailed && (
        <div>
          <Button size="sm" variant="primary" onClick={session.retry}>Retry</Button>
        </div>
      )}
      {loading && <p className="muted" role="status">Loading projects…</p>}
      {signedIn ? null : connect && linked.reports.length > 0 ? (
        <details className="overleaf-conn-details">
          <summary>Sign in to Overleaf to write live and see the PDF</summary>
          {connect}
        </details>
      ) : (
        connect
      )}

      {open ? (
        <OverleafProjectDetail
          key={open.id}
          row={open}
          session={session}
          client={client}
          inShell={inShell}
          canEditAsFiles={canEditAsFiles}
          projectId={projectId}
          gateway={gateway}
          onUnlink={linked.unlink}
          onSaveTargets={linked.saveTargets}
          onLinksChanged={() => void linked.reload()}
          onError={linked.setError}
          onBack={() => setOpenId(null)}
        />
      ) : rows.length === 0 && !loading ? (
        <div className="overleaf-empty">
          <h2>No Overleaf projects yet</h2>
          <p className="muted">
            {signedIn ? "This Overleaf account has no projects. " : ""}
            Start one from this project&apos;s report as a ZIP, or link an existing one with a Git token.
          </p>
          <div className="linked-overleaf-form__actions">
            <Button variant="primary" onClick={onExport}>Export ZIP</Button>
            {projectId && <Button onClick={() => setLinkOpen((v) => !v)}>{linkOpen ? "Cancel" : "Link a project (Git token)"}</Button>}
            {settingsButton}
          </div>
          {settings}
          {linkForm}
        </div>
      ) : rows.length > 0 ? (
        <div className="overleaf-project-list">
          <div className="overleaf-project-list__head">
            <h2>Your projects</h2>
            <input
              type="search"
              aria-label="Search projects"
              placeholder="Search projects"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {projectId && (
              <Button size="sm" onClick={() => setLinkOpen((v) => !v)} title="Link a project you can't sign in to, or keep word targets">
                {linkOpen ? "Cancel" : "Link a project (Git token)"}
              </Button>
            )}
            {settingsButton}
          </div>
          {settings}
          {linkForm}
          {visible.length < rows.length && (
            <p className="muted overleaf-project-list__hint">{`Showing ${visible.length} of ${rows.length} projects. Choose which in Settings.`}</p>
          )}
          {visible.length === 0 ? (
            <p className="muted">No projects chosen to show. Pick some in Settings.</p>
          ) : shown.length === 0 ? (
            <p className="muted">No projects match “{query.trim()}”.</p>
          ) : (
            <ul>
              {shown.map((row) => (
                <li key={row.id}>
                  <RowButton onClick={() => setOpenId(row.id)}>
                    <strong>
                      {row.report && <span className="overleaf-star" title="Linked to this WeaveForge project">★ </span>}
                      {row.name}
                    </strong>
                    <small>{rowMeta(row, signedIn)}</small>
                  </RowButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
