"use client";

import { useEffect, useState } from "react";
import { authHeaders } from "@/lib/auth-headers";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { Select } from "@/components/select";
import {
  listWorkshopProjects,
  signInToWorkshop,
  signOutOfWorkshop,
  type WorkshopClientDeps,
  type WorkshopProject,
} from "@/features/overleaf/infrastructure/workshop-session-client";
import { WorkshopPdfViewer, type WorkshopPdfViewerProps } from "./workshop-pdf-viewer";

/** Where this browser remembers its Workshop session id. Only the opaque id, never the cookie. */
export interface WorkshopSessionStore {
  get(): string | null;
  set(sessionId: string | null): void;
}

const STORAGE_KEY = "weaveforge.overleaf.workshopSession";

/** Per-browser convenience: storage can be missing or throw (private window), and then the user signs in again. */
const browserStore: WorkshopSessionStore = {
  get() {
    try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
  },
  set(sessionId) {
    try {
      if (sessionId) window.localStorage.setItem(STORAGE_KEY, sessionId);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch { /* not remembered; nothing else depends on it */ }
  },
};

const browserClient: WorkshopClientDeps = { fetch: (url, init) => fetch(url, init), authHeaders };

/**
 * The panel needs the app's /api/overleaf/workshop routes. A copy with no account
 * has none, and neither has the desktop shell: it serves a static bundle and
 * relays only the /api paths in apps/desktop/src/app-relays.ts.
 */
export function canShowWorkshop({ localMode, inDesktopShell }: { localMode: boolean; inDesktopShell: boolean }): boolean {
  return !localMode && !inDesktopShell;
}

/**
 * Overleaf Workshop: sign in with an Overleaf session cookie, pick a project and
 * its root .tex file, and see the PDF Overleaf compiles. The cookie is sent once
 * and sealed server-side; this panel only ever holds the session id.
 */
export function WorkshopPanel({ client = browserClient, store = browserStore }: {
  client?: WorkshopClientDeps;
  store?: WorkshopSessionStore;
}) {
  const [sessionId, setSessionId] = useState<string | null>(() => store.get());
  const [projects, setProjects] = useState<WorkshopProject[] | null>(null);
  const [cookies, setCookies] = useState("");
  const [projectId, setProjectId] = useState("");
  const [root, setRoot] = useState("main.tex");
  const [shown, setShown] = useState<WorkshopPdfViewerProps | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** The project list failed for the stored session; Retry bumps `attempt` to load again. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setProjects(null);
    setLoadFailed(false);
    void listWorkshopProjects(client, sessionId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setError("");
        setProjects(result.projects);
        setProjectId((current) => (result.projects.some((p) => p.id === current) ? current : (result.projects[0]?.id ?? "")));
        return;
      }
      setError(result.message);
      if (result.expired) {
        store.set(null);
        setSessionId(null);
      } else {
        setLoadFailed(true);
      }
    });
    return () => { cancelled = true; };
  }, [sessionId, client, store, attempt]);

  function forget() {
    store.set(null);
    setSessionId(null);
    setProjects(null);
    setLoadFailed(false);
    setShown(null);
  }

  async function signIn(event: { preventDefault(): void }) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await signInToWorkshop(client, cookies);
    setBusy(false);
    if (!result.ok) { setError(result.message); return; }
    setCookies("");
    store.set(result.sessionId);
    setSessionId(result.sessionId);
  }

  async function disconnect() {
    if (sessionId) await signOutOfWorkshop(client, sessionId);
    setError("");
    forget();
  }

  const rootFile = root.trim();
  function showPdf(event: { preventDefault(): void }) {
    event.preventDefault();
    if (!sessionId || !projectId || !rootFile) return;
    setShown({ sessionId, projectId, rootResourcePath: rootFile });
  }

  return (
    <section className="workshop-panel" aria-label="Overleaf PDF">
      <h2>Overleaf PDF</h2>
      {error && <FormError>{error}</FormError>}
      {!sessionId ? (
        <form className="linked-overleaf-form" onSubmit={(event) => void signIn(event)}>
          <label>
            Overleaf session cookie
            <input
              name="cookies"
              type="password"
              autoComplete="off"
              placeholder="overleaf_session2=…"
              value={cookies}
              onChange={(event) => setCookies(event.target.value)}
            />
          </label>
          <p className="muted">
            Copy the <code>overleaf_session2</code> cookie from overleaf.com. It is stored encrypted on the server and never shown again.
          </p>
          <div className="linked-overleaf-form__actions">
            <Button variant="primary" type="submit" disabled={busy || !cookies.trim()}>
              {busy ? "Connecting…" : "Connect Overleaf"}
            </Button>
          </div>
        </form>
      ) : projects === null && loadFailed ? (
        <div className="linked-overleaf-form__actions">
          <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>Retry</Button>
          <Button variant="cancel" onClick={() => void disconnect()}>Disconnect</Button>
        </div>
      ) : projects === null ? (
        <p className="muted">Loading Overleaf projects…</p>
      ) : (
        <form className="linked-overleaf-form" onSubmit={showPdf}>
          {projects.length === 0 ? (
            <p className="muted">No Overleaf projects found for this account.</p>
          ) : (
            <>
              <label>
                Project
                <Select name="projectId" aria-label="Project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </label>
              <label>
                Root file
                <input name="rootResourcePath" value={root} onChange={(event) => setRoot(event.target.value)} />
              </label>
            </>
          )}
          <div className="linked-overleaf-form__actions">
            {projects.length > 0 && (
              <Button variant="primary" type="submit" disabled={!projectId || !rootFile}>Show PDF</Button>
            )}
            <Button variant="cancel" onClick={() => void disconnect()}>Disconnect</Button>
          </div>
        </form>
      )}
      {shown && <WorkshopPdfViewer {...shown} />}
    </section>
  );
}
