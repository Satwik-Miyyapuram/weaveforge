"use client";

import { useEffect, useState } from "react";
import { getContainer } from "@/bootstrap";
import { authHeaders } from "@/lib/auth-headers";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { Select } from "@/components/select";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { formatError } from "@/lib/format-error";
import { overleafSyncAvailable } from "@/features/overleaf/application/overleaf-folder-sync";
import {
  listWorkshopProjects,
  signInToWorkshop,
  signOutOfWorkshop,
  type WorkshopClientDeps,
  type WorkshopProject,
} from "@/features/overleaf/infrastructure/workshop-session-client";
import { WorkshopLiveEditor } from "./workshop-live-editor";
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

/** A copy with no account calls the shell's own routes, which take no bearer token. */
async function workshopHeaders(extra?: HeadersInit): Promise<HeadersInit> {
  if (getContainer().auth.isLocalMode()) return { ...(extra as Record<string, string> | undefined) };
  return authHeaders(extra);
}

const browserClient: WorkshopClientDeps = { fetch: (url, init) => fetch(url, init), authHeaders: workshopHeaders };

/**
 * The panel needs /api/overleaf/workshop routes. The hosted app has them, and the
 * Tauri shell serves them itself (apps/shell/src/overleaf_workshop.rs), so only a
 * browser copy with no account goes without.
 */
export function canShowWorkshop({ localMode, shell = false }: { localMode: boolean; shell?: boolean }): boolean {
  return !localMode || shell;
}

type ConnectMode = "signin" | "git";

const SIGN_IN_TIP =
  "Opens overleaf.com in an app window. Works on any plan; Overleaf compiles the PDF; in the desktop app you can also edit the files live. " +
  "Saved browser passwords don't fill in there, but Google/ORCID sign-in and desktop password managers work. " +
  "Google may refuse embedded windows.";

const GIT_TIP =
  "Pull and push the project as files in your vault and compile locally. Needs an Overleaf plan or institution " +
  "licence with Git (TU Delft has one); the git token lasts about a year; needs local LaTeX " +
  "(MiKTeX, TeX Live or Tectonic).";

/** The two ways to connect. The tip holds the details; the hint is the one line always shown. */
const CONNECT_OPTIONS: readonly { mode: ConnectMode; label: string; hint: string; tip: string }[] = [
  { mode: "signin", label: "Sign in to Overleaf", hint: "Any plan. View the PDF; edit live in the desktop app.", tip: SIGN_IN_TIP },
  { mode: "git", label: "Edit as files (Git token)", hint: "Paid or institution plan. Edit in your vault, compile locally.", tip: GIT_TIP },
];

/**
 * Overleaf Workshop: sign in to Overleaf, pick a project and see the PDF Overleaf
 * compiles from the project's main document. The cookie is sent once
 * and kept by the routes (sealed on the server, or in this device's keychain when
 * `inShell`); this panel only ever holds the session id.
 */
export function WorkshopPanel({
  client = browserClient,
  store = browserStore,
  inShell = false,
  signInWindow = desktop()?.overleafSignIn,
  canEditAsFiles = overleafSyncAvailable(),
}: {
  client?: WorkshopClientDeps;
  store?: WorkshopSessionStore;
  inShell?: boolean;
  /** Opens Overleaf's own sign-in in an app window; answers a session id, or null if closed. */
  signInWindow?: () => Promise<string | null>;
  /** Git pull/push into the vault is available (desktop app only). */
  canEditAsFiles?: boolean;
}) {
  const [mode, setMode] = useState<ConnectMode>("signin");
  const [sessionId, setSessionId] = useState<string | null>(() => store.get());
  const [projects, setProjects] = useState<WorkshopProject[] | null>(null);
  const [cookies, setCookies] = useState("");
  const [projectId, setProjectId] = useState("");
  const [shown, setShown] = useState<WorkshopPdfViewerProps | null>(null);
  /** The project open in the live editor (desktop app only). */
  const [editing, setEditing] = useState<{ sessionId: string; projectId: string } | null>(null);
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
    setEditing(null);
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

  function showPdf(event: { preventDefault(): void }) {
    event.preventDefault();
    if (!sessionId || !projectId) return;
    setShown({ sessionId, projectId });
  }

  async function openSignIn() {
    if (!signInWindow) return;
    setBusy(true);
    setError("");
    try {
      const id = await signInWindow();
      if (id) {
        store.set(id);
        setSessionId(id);
      }
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setBusy(false);
    }
  }

  const cookieForm = (
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
        Copy the <code>overleaf_session2</code> cookie from overleaf.com.{" "}
        {inShell
          ? "It is kept encrypted in this device's keychain, is never shown again, and is removed when you sign out."
          : "It is stored encrypted on the server and never shown again."}
      </p>
      <div className="linked-overleaf-form__actions">
        <Button variant="primary" type="submit" disabled={busy || !cookies.trim()}>
          {busy ? "Connecting…" : "Connect Overleaf"}
        </Button>
      </div>
    </form>
  );

  return (
    <section className="workshop-panel" aria-label="Overleaf">
      <h2>Overleaf</h2>
      {error && <FormError>{error}</FormError>}
      {!sessionId ? (
        <div className="overleaf-connect">
          <fieldset className="overleaf-connect__choice">
            <legend>How do you want to connect?</legend>
            {CONNECT_OPTIONS.map((option) => (
              <label key={option.mode} title={option.tip} className="overleaf-connect__option">
                <input
                  type="radio"
                  name="overleafConnect"
                  value={option.mode}
                  checked={mode === option.mode}
                  onChange={() => setMode(option.mode)}
                />
                <span>
                  <strong>{option.label}</strong>
                  <span className="muted"> {option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {mode === "git" ? (
            canEditAsFiles ? (
              <div className="linked-overleaf-form__actions">
                <Button href="/settings#settings-workspace" title="Save your Overleaf git token and link a project to a vault folder">
                  Open Overleaf projects in Settings
                </Button>
              </div>
            ) : (
              <p className="muted">Editing as files needs the WeaveForge desktop app.</p>
            )
          ) : signInWindow ? (
            <>
              <div className="linked-overleaf-form__actions">
                <Button variant="primary" disabled={busy} onClick={() => void openSignIn()} title={SIGN_IN_TIP}>
                  {busy ? "Waiting for sign-in…" : "Sign in to Overleaf"}
                </Button>
              </div>
              <details className="overleaf-connect__fallback">
                <summary>Paste a session cookie instead</summary>
                {cookieForm}
              </details>
            </>
          ) : (
            cookieForm
          )}
        </div>
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
            <label>
              Project
              <Select name="projectId" aria-label="Project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </label>
          )}
          <div className="linked-overleaf-form__actions">
            {projects.length > 0 && (
              <Button
                variant="primary"
                type="submit"
                disabled={!projectId}
                title="Overleaf compiles the project's main document (set in Overleaf's Menu)"
              >
                Show PDF
              </Button>
            )}
            {inShell && projects.length > 0 && (
              <Button
                disabled={!projectId}
                title="Edit the project's files here; edits reach Overleaf as you type"
                onClick={() => sessionId && projectId && setEditing({ sessionId, projectId })}
              >
                Edit
              </Button>
            )}
            <Button variant="cancel" onClick={() => void disconnect()}>Disconnect</Button>
          </div>
        </form>
      )}
      {editing && (
        <WorkshopLiveEditor
          key={`${editing.sessionId}:${editing.projectId}`}
          client={client}
          sessionId={editing.sessionId}
          projectId={editing.projectId}
          onClose={() => setEditing(null)}
        />
      )}
      {shown && <WorkshopPdfViewer {...shown} authHeaders={client.authHeaders} />}
    </section>
  );
}
