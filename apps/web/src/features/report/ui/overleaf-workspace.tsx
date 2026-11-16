"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { Menu, type MenuItem } from "@/components/menu";
import { Popover } from "@/components/popover";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { overleafSyncAvailable } from "@/features/overleaf/application/parts";
import type { WorkshopClientDeps } from "@/features/overleaf/infrastructure/workshop-session-client";
import {
  filterOverleafProjects,
  mergeOverleafProjects,
  pickedOverleafProjects,
  type OverleafProjectRow,
} from "../lib/parts";
import { local } from "./linked-overleaf-api";
import { OverleafConnect } from "./overleaf-connect";
import { OverleafProjectCard } from "./overleaf-project-card";
import { OverleafProjectDetail } from "./overleaf-project-detail";
import { browserPicksStore, type ProjectPicksStore } from "./overleaf-project-picks";
import { LinkOverleafForm } from "./overleaf-report-forms";
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
 * marked ★). "Choose projects" turns the list into checkboxes for which
 * account projects show. Opening one shows Write and PDF.
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
  onlyProjectId,
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
  /** Shows just this Overleaf project, as the editor's sidebar opens it: no list, no back. */
  onlyProjectId?: string;
}) {
  const session = useWorkshopSession({ client, store, signInWindow, enabled: workshop });
  const linked = useLinkedReports(projectId, gateway);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(onlyProjectId ?? null);
  const [linkOpen, setLinkOpen] = useState(false);
  /** The ticked ids while choosing which projects show; null when not choosing. */
  const [draft, setDraft] = useState<Set<string> | null>(null);
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

  const accountIds = rows.filter((row) => !row.report).map((row) => row.id);
  const choosing = draft !== null;
  const startChoosing = () => { setDraft(new Set(visible.filter((row) => !row.report).map((row) => row.id))); setQuery(""); };
  const toggle = (id: string) => setDraft((was) => {
    const next = new Set(was);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const finishChoosing = () => {
    if (draft) pick(accountIds.every((id) => draft.has(id)) ? null : draft);
    setDraft(null);
  };

  const menuItems: MenuItem[] = [
    ...(signedIn ? [{ id: "account", kind: "header" as const, label: "Signed in to Overleaf" }] : []),
    ...(projectId
      ? [{ id: "link", label: "Link a project (Git token)", title: "Link a project you can't sign in to", onSelect: () => setLinkOpen(true) }]
      : []),
    ...(signedIn ? [{ id: "disconnect", label: "Disconnect", danger: true, onSelect: () => void session.disconnect() }] : []),
  ];
  const accountMenu = menuItems.length > 0 && (
    <Popover trigger="icon" label="⋯" ariaLabel="Overleaf account" align="right">
      {(close) => <Menu onClose={close} ariaLabel="Overleaf account" items={menuItems} />}
    </Popover>
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
      <div>
        <Button size="sm" variant="cancel" onClick={() => setLinkOpen(false)}>Cancel</Button>
      </div>
    </>
  );

  const status = (
    <>
      {error && <FormError>{error}</FormError>}
      {session.loadFailed && (
        <div>
          <Button size="sm" variant="primary" onClick={session.retry}>Retry</Button>
        </div>
      )}
      {loading && <p className="muted" role="status">Loading projects…</p>}
    </>
  );

  const detail = (row: OverleafProjectRow, onBack?: () => void) => (
    <OverleafProjectDetail
      key={row.id}
      row={row}
      session={session}
      client={client}
      inShell={inShell}
      canEditAsFiles={canEditAsFiles}
      projectId={projectId}
      onUnlink={linked.unlink}
      onLinksChanged={() => void linked.reload()}
      onError={linked.setError}
      onBack={onBack}
    />
  );

  if (onlyProjectId) {
    return (
      <section className="overleaf-workspace" aria-label="Overleaf project">
        {status}
        {!signedIn && connect}
        {open
          ? detail(open)
          : session.projects !== null && <p className="muted">This project is not in your Overleaf account or linked to this project.</p>}
      </section>
    );
  }

  return (
    <section className="overleaf-workspace" aria-label="Overleaf projects">
      {status}
      {signedIn ? null : connect && linked.reports.length > 0 ? (
        <details className="overleaf-conn-details">
          <summary>Sign in to Overleaf to write live and see the PDF</summary>
          {connect}
        </details>
      ) : (
        connect
      )}

      {open ? (
        detail(open, () => setOpenId(null))
      ) : rows.length === 0 && !loading ? (
        <div className="overleaf-empty">
          <h2>No Overleaf projects yet</h2>
          <p className="muted">
            {signedIn ? "This Overleaf account has no projects. " : ""}
            Start one from this project&apos;s report as a ZIP, or link an existing one with a Git token.
          </p>
          <div className="linked-overleaf-form__actions">
            <Button variant="primary" onClick={onExport}>Export for Overleaf</Button>
            {projectId && !linkOpen && <Button onClick={() => setLinkOpen(true)}>Link a project (Git token)</Button>}
            {accountMenu}
          </div>
          {linkForm}
        </div>
      ) : rows.length > 0 ? (
        <div className="overleaf-project-list">
          <div className="overleaf-project-list__head">
            <h2>{choosing ? "Choose projects to show" : "Overleaf projects"}</h2>
            {choosing ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setDraft(new Set(accountIds))}>All</Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft(new Set())}>None</Button>
                <Button size="sm" variant="cancel" onClick={() => setDraft(null)}>Cancel</Button>
                <Button size="sm" variant="primary" onClick={finishChoosing}>Done</Button>
              </>
            ) : (
              <>
                {signedIn && accountIds.length > 0 && (
                  <Button size="sm" onClick={startChoosing} title="Pick which of your Overleaf projects show here">Choose projects</Button>
                )}
                {accountMenu}
              </>
            )}
          </div>
          {linkForm}
          <input
            className="overleaf-project-list__search"
            type="search"
            aria-label="Search projects"
            placeholder="Search projects"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {choosing ? (
            <ul className="overleaf-picks">
              {filterOverleafProjects(rows, query).map((row) => (
                <li key={row.id}>
                  <label className="overleaf-pick">
                    <input
                      type="checkbox"
                      className="wf-check"
                      checked={Boolean(row.report) || draft.has(row.id)}
                      disabled={Boolean(row.report)}
                      onChange={() => toggle(row.id)}
                    />
                    <span>
                      <strong>
                        {row.report && <span className="overleaf-star" title="Linked to this WeaveForge project">★ </span>}
                        {row.name}
                      </strong>
                      <small>{row.report ? "Linked, always shown" : "In your Overleaf account"}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : visible.length === 0 ? (
            <p className="muted">No projects shown. Use Choose projects to pick some.</p>
          ) : shown.length === 0 ? (
            <p className="muted">No projects match “{query.trim()}”.</p>
          ) : (
            <ul className="overleaf-cards">
              {shown.map((row) => (
                <OverleafProjectCard
                  key={row.id}
                  row={row}
                  meta={rowMeta(row, signedIn)}
                  sessionId={session.sessionId}
                  authHeaders={client.authHeaders}
                  onOpen={() => setOpenId(row.id)}
                />
              ))}
            </ul>
          )}
          {!choosing && visible.length > 0 && visible.length < rows.length && (
            <p className="muted overleaf-project-list__hint">{`${rows.length - visible.length} hidden`}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
