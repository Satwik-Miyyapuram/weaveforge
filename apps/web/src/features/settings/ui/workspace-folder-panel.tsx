"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ImportDiff, WorkspaceCommit } from "@weaveforge/core";
import { formatError } from "@/lib/format-error";
import { desktop } from "@/lib/desktop/desktop-bridge";
import {
  applyFolderImport,
  chooseDesktopFolder,
  chooseFolder,
  closeFolder,
  folderHistory,
  folderSession,
  previewArchiveImport,
  clearExternalChanges,
  writeMarkersFor,
  type ConflictResolution,
  type FolderSession,
  externalChanges,
  onExternalChange,
  previewFolderImport,
  supportsDirectoryPicker,
  syncToFolder,
  openBrowserStorageFolder,
} from "@/features/workspace/application/workspace-folder";
import { FormError } from "@/components/form-error";
import dynamic from "next/dynamic";

const FolderConflictCard = dynamic(
  () => import("./folder-conflict-card").then((m) => m.FolderConflictCard),
  { ssr: false },
);

/** Where the local database is (desktop only: a browser has none). */
function useDatabaseLocation(): { dataDir: string; failure: string | null } | null {
  const [state, setState] = useState<{ dataDir: string; failure: string | null } | null>(null);
  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;
    let live = true;
    void bridge
      .localDbState()
      .then((value) => {
        if (live) setState({ dataDir: value.dataDir, failure: value.failure });
      })
      .catch(() => {}); // an older shell without the channel: no row
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** One labelled fact in the `.account-info-grid`; a real row element keeps the two columns. */
function StatusRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="account-info-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** A path, monospaced and allowed to break rather than overflow the card. */
function PathValue({ path }: { path: string }) {
  return (
    <span className="app-log-path">
      <code>{path}</code>
    </span>
  );
}

/** The desktop folder's path; the shell keeps it, the page only reads it. */
function useFolderPath(session: FolderSession | null): string | null {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    const bridge = desktop();
    if (session?.kind !== "desktop" || !bridge) {
      setPath(null);
      return;
    }
    let live = true;
    void bridge
      .vaultRoot()
      .then((root) => {
        if (live) setPath(root?.path ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [session]);
  return path;
}

/** Settings → Workspace: facts first, then one section per job, each with its own buttons. */
export function WorkspaceFolderPanel() {
  const [session, setSession] = useState(folderSession());
  const [git, setGit] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly WorkspaceCommit[]>([]);
  const [diff, setDiff] = useState<(ImportDiff & { skipped?: string[] }) | null>(null);
  const archiveInput = useRef<HTMLInputElement | null>(null);
  // Resolved after mount: the server has no shell, and disagreeing would be a hydration mismatch.
  const [hasShell, setHasShell] = useState(false);
  useEffect(() => setHasShell(desktop() !== null), []);
  const database = useDatabaseLocation();
  const folderPath = useFolderPath(session);

  // Files something else changed in the folder; shown, never applied.
  const [outside, setOutside] = useState<string[]>([]);
  useEffect(() => {
    setOutside(externalChanges());
    return onExternalChange(setOutside);
  }, []);

  // Reconnect the folder the shell remembers, without opening a dialog.
  useEffect(() => {
    if (!hasShell || session) return;
    let live = true;
    void chooseDesktopFolder({ git: false, reuse: true })
      .then((adopted) => {
        if (live && adopted) setSession(folderSession());
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShell]);

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(null);
    }
  };

  const folderValue =
    session === null ? (
      "Not connected"
    ) : session.kind === "opfs" ? (
      "Browser storage (not visible in Explorer or Finder)"
    ) : folderPath ? (
      <PathValue path={folderPath} />
    ) : (
      "A folder picked in this browser"
    );

  return (
    <section
      id="settings-workspace"
      className="card add-form settings-anchor"
      role="tabpanel"
      aria-labelledby="settings-tab-workspace"
    >
      <h3 className="settings-group">Workspace</h3>
      <p className="muted jump-to-meta">
        Your work lives in the app&rsquo;s database and is mirrored to the folder as Markdown
        you can open in Obsidian, VS Code or Explorer. The database is backed up separately.
      </p>

      <dl className="account-info-grid">
        <StatusRow label="Folder">{folderValue}</StatusRow>
        {session && (
          <StatusRow label="Mirror">
            On — each edit is written a moment later
            {session.git === "isomorphic" ? ", with git history" : ""}
          </StatusRow>
        )}
        {session && (
          <StatusRow label="Outside edits">
            {outside.length === 0
              ? "None"
              : `${outside.length} file${outside.length === 1 ? "" : "s"} changed outside WeaveForge — not in the app yet`}
          </StatusRow>
        )}
        {database?.dataDir && (
          <StatusRow label="Database">
            <PathValue path={database.dataDir} />
          </StatusRow>
        )}
      </dl>

      {error && <FormError>{error}</FormError>}
      {status && <p className="muted">{status}</p>}
      {database?.failure && <FormError>{database.failure}</FormError>}

      <h4 className="settings-group">Folder</h4>
      {!session ? (
        <>
          <p className="muted jump-to-meta">
            Pick any folder; if it holds other files, WeaveForge keeps its own in a{" "}
            <strong>WeaveForge</strong> subfolder.
          </p>
          <label className="field-inline">
            <input
              type="checkbox"
              className="themed-check"
              checked={git}
              onChange={(e) => setGit(e.target.checked)}
            />
            Keep a local git history of the folder
          </label>
          <div className="screen-actions">
            {(hasShell || supportsDirectoryPicker()) && (
              <button
                className="btn-primary"
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run("pick", async () => {
                    const picked = hasShell ? await chooseDesktopFolder({ git }) : await chooseFolder({ git });
                    if (picked) setSession(folderSession());
                  })
                }
              >
                {busy === "pick" ? "Choosing…" : "Choose a folder…"}
              </button>
            )}
            <button
              className="btn-secondary"
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void run("opfs", async () => {
                  await openBrowserStorageFolder({ git });
                  setSession(folderSession());
                })
              }
            >
              {busy === "opfs" ? "Setting up…" : "Use browser storage"}
            </button>
          </div>
          {!hasShell && !supportsDirectoryPicker() && (
            <p className="muted jump-to-meta">Choosing a real folder needs a Chromium-based browser.</p>
          )}
        </>
      ) : (
        <>
          <p className="muted jump-to-meta">
            The mirror runs by itself. Write now before opening the folder in another editor.
          </p>
          <div className="screen-actions">
            <button
              className="btn-secondary"
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void run("sync", async () => {
                  const result = await syncToFolder();
                  setStatus(
                    `Wrote ${result.mirror.written.length} file${result.mirror.written.length === 1 ? "" : "s"}` +
                      (result.mirror.removed.length ? `, removed ${result.mirror.removed.length}` : "") +
                      (result.commit ? ` · committed "${result.commit.message}"` : "") +
                      (result.mirror.written.length === 0 && !result.commit ? " — already up to date" : "."),
                  );
                  setHistory(await folderHistory());
                })
              }
            >
              {busy === "sync" ? "Writing…" : "Write everything now"}
            </button>
            <button
              className="btn-ghost"
              type="button"
              disabled={busy !== null}
              onClick={() => {
                closeFolder();
                setSession(null);
                setHistory([]);
                setDiff(null);
                setStatus(null);
              }}
            >
              Disconnect
            </button>
          </div>
          {history.length > 0 && (
            <ul className="wiki-lint-list">
              {history.map((commit) => (
                <li key={commit.oid}>
                  {commit.message}
                  <span className="jump-to-meta"> · {commit.authoredAt.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <h4 className="settings-group">Bring changes back in</h4>
      <p className="muted jump-to-meta">
        Import notes edited outside the app, from the folder or a ZIP. You see the diff before
        anything is written.
      </p>
      {/* A real button drives the hidden input: the raw "Choose File" control is off-brand. */}
      <input
        ref={archiveInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          void run("zip", async () => {
            setDiff(await previewArchiveImport(new Uint8Array(await file.arrayBuffer())));
          });
        }}
      />
      <div className="screen-actions">
        {session && (
          <button
            className={outside.length > 0 ? "btn-primary" : "btn-secondary"}
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run("preview", async () => {
                setDiff(await previewFolderImport());
                clearExternalChanges();
              })
            }
          >
            {busy === "preview"
              ? "Reading…"
              : outside.length > 0
                ? `Review ${outside.length} outside edit${outside.length === 1 ? "" : "s"}`
                : "Check for changes"}
          </button>
        )}
        <button
          className="btn-secondary"
          type="button"
          disabled={busy !== null}
          onClick={() => archiveInput.current?.click()}
        >
          {busy === "zip" ? "Reading…" : "Import a ZIP…"}
        </button>
      </div>
      {diff && <ImportPreview diff={diff} onApplied={(msg) => { setStatus(msg); setDiff(null); }} />}

    </section>
  );
}

function ImportPreview({
  diff,
  onApplied,
}: {
  diff: ImportDiff & { skipped?: string[] };
  onApplied: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * How each conflicted file is to be settled, by path.
   *
   * Empty means "keep the workspace's copy" for all of them, which is why a
   * conflict left alone is never written: the default has to be the choice
   * that discards nothing the user can still see.
   */
  const [resolutions, setResolutions] = useState<Record<string, ConflictResolution>>({});
  const conflicts = diff.entries.filter((entry) => entry.action === "conflict");
  const settled = conflicts.filter((entry) => {
    const res = resolutions[entry.entity.path];
    return res !== undefined && res !== "keep" && res !== "markers";
  }).length;
  const writable = diff.counts.created + diff.counts.updated + diff.counts.removed + settled;

  return (
    <div className="field">
      <p className="muted">
        {diff.counts.created} new · {diff.counts.updated} changed · {diff.counts.removed} removed ·{" "}
        {diff.counts.unchanged} unchanged · {diff.counts.conflict} conflict
        {diff.counts.conflict === 1 ? "" : "s"}
        {diff.skipped?.length ? ` · ${diff.skipped.length} file(s) skipped as unsafe` : ""}
      </p>

      {conflicts.length > 0 && (
        <ul className="wiki-lint-list">
          {conflicts.slice(0, 10).map((entry) => {
            const path = entry.entity.path;
            return (
              <FolderConflictCard
                key={path}
                entry={entry}
                chosen={resolutions[path] ?? "keep"}
                onChoose={(resolution) =>
                  setResolutions((current) => ({ ...current, [path]: resolution }))
                }
                onWriteMarkers={() => writeMarkersFor(entry)}
              />
            );
          })}
        </ul>
      )}

      {error && <FormError>{error}</FormError>}

      <div className="screen-actions">
        <button
          className="btn-primary"
          type="button"
          disabled={busy || writable === 0}
          onClick={() => {
            setBusy(true);
            setError(null);
            void applyFolderImport(diff, resolutions)
              .then((result) =>
                onApplied(`Imported ${result.created} new and ${result.updated} changed note(s).`),
              )
              .catch((err) => setError(formatError(err)))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? "Importing…" : `Import ${writable} note${writable === 1 ? "" : "s"}`}
        </button>
      </div>
      <p className="muted jump-to-meta">
        Only notes are imported. Papers and experiments carry structured fields a markdown body
        cannot round-trip, and a half-imported paper is worse than an unimported one. Edits made
        on both sides are merged field by field where they do not collide; where they do, nothing
        is written over until you say which copy wins.
      </p>
    </div>
  );
}
