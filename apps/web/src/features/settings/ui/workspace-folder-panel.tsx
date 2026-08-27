"use client";

import { useEffect, useRef, useState } from "react";
import type { ImportDiff, WorkspaceCommit } from "@weaveforge/core";
import { formatError } from "@/lib/format-error";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { LocalApiPanel } from "./local-api-panel";
import {
  applyFolderImport,
  chooseDesktopFolder,
  chooseFolder,
  closeFolder,
  folderHistory,
  folderSession,
  previewArchiveImport,
  clearExternalChanges,
  keepBothTitle,
  type ConflictResolution,
  externalChanges,
  onExternalChange,
  previewFolderImport,
  supportsDirectoryPicker,
  syncToFolder,
  openBrowserStorageFolder,
} from "@/features/workspace/application/workspace-folder";

/**
 * Settings → Folder.
 *
 * The workspace as a folder of markdown you can open in Obsidian, optionally
 * with local git history. Supabase stays the source of truth: the folder is
 * written from it, and pulling changes back is an explicit action with a diff
 * shown first, never a background sync.
 */
export function WorkspaceFolderPanel() {
  const [session, setSession] = useState(folderSession());
  const [git, setGit] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly WorkspaceCommit[]>([]);
  const [diff, setDiff] = useState<(ImportDiff & { skipped?: string[] }) | null>(null);
  const archiveInput = useRef<HTMLInputElement | null>(null);
  // Resolved after mount, never during render: the server has no shell, and a
  // first render that disagreed with it would be a hydration mismatch.
  const [hasShell, setHasShell] = useState(false);
  useEffect(() => setHasShell(desktop() !== null), []);

  /**
   * What somebody else changed in the folder, where the shell can see it.
   *
   * Shown, not applied: the reader gets the same diff they would get from
   * "Check folder for changes", having been told there is something to check.
   */
  const [outside, setOutside] = useState<string[]>([]);
  useEffect(() => {
    setOutside(externalChanges());
    return onExternalChange(setOutside);
  }, []);

  /**
   * Take up the folder the desktop shell already remembers.
   *
   * The shell re-checks that the path still exists before answering, so this
   * reconnects a folder across restarts without ever opening a dialog the user
   * did not ask for. A folder already chosen this session wins: reconnecting
   * over it would silently swap where the next write lands.
   */
  useEffect(() => {
    if (!hasShell || session) return;
    let live = true;
    void chooseDesktopFolder({ git: false, reuse: true })
      .then((adopted) => {
        if (live && adopted) setSession(folderSession());
      })
      .catch(() => {
        // A remembered folder that has since gone -- an unplugged drive, a
        // dead network share -- leaves the panel exactly as it was.
      });
    return () => {
      live = false;
    };
    // Runs for the empty state only; once connected there is nothing to adopt.
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

  return (
    <section
      id="settings-folder"
      className="card add-form settings-anchor"
      role="tabpanel"
      aria-labelledby="settings-tab-folder"
    >
      <h3 className="settings-group">Folder</h3>
      <p className="muted">
        Write your workspace out as markdown you can open in Obsidian or VS Code. Every file
        records its id, so renaming and moving files is safe.
      </p>

      {error && <p className="error">{error}</p>}
      {status && <p className="muted">{status}</p>}

      {!session ? (
        <div className="field">
          <label className="field-inline">
            <input
              type="checkbox"
              className="themed-check"
              checked={git}
              onChange={(e) => setGit(e.target.checked)}
            />
            Keep a git history of the folder
          </label>
          <p className="muted jump-to-meta">
            Local history only — commits stay on this device. There is no push, pull, or merge.
          </p>
          <div className="screen-actions">
            {hasShell && (
              <button
                className="btn-secondary"
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run("desktop", async () => {
                    if (await chooseDesktopFolder({ git })) setSession(folderSession());
                  })
                }
              >
                Choose a folder…
              </button>
            )}
            {!hasShell && supportsDirectoryPicker() && (
              <button
                className="btn-secondary"
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run("pick", async () => {
                    if (await chooseFolder({ git })) setSession(folderSession());
                  })
                }
              >
                Choose a folder…
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
              Use browser storage
            </button>
          </div>
          {!hasShell && !supportsDirectoryPicker() && (
            <p className="muted jump-to-meta">
              Choosing a real folder needs a Chromium-based browser. Browser storage works
              everywhere, but the files are not visible in Finder or Explorer.
            </p>
          )}
        </div>
      ) : (
        <div className="field">
          <p className="muted">
            Connected to{" "}
            {session.kind === "opfs"
              ? "browser storage"
              : "a folder on this device"}
            {session.git === "isomorphic" ? ", with git history" : ""}.
          </p>
          {outside.length > 0 && (
            <p className="muted jump-to-meta">
              {outside.length === 1
                ? "One file changed in the folder outside WeaveForge"
                : `${outside.length} files changed in the folder outside WeaveForge`}
              . Check the folder to see what.
            </p>
          )}
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
              {busy === "sync" ? "Writing…" : "Write workspace to folder"}
            </button>
            <button
              className="btn-secondary"
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void run("preview", async () => {
                  setDiff(await previewFolderImport());
                  clearExternalChanges();
                })
              }
            >
              {busy === "preview" ? "Reading…" : "Check folder for changes"}
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
            <>
              <h4 className="settings-group">History</h4>
              <ul className="wiki-lint-list">
                {history.map((commit) => (
                  <li key={commit.oid}>
                    {commit.message}
                    <span className="jump-to-meta"> · {commit.authoredAt.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <h4 className="settings-group">Bring changes back in</h4>
      <p className="muted jump-to-meta">
        Edited the files somewhere else? Import them here. Notes are matched by their recorded
        id, so renames are handled. You see the diff before anything is written.
      </p>
      {/* The native control is driven by a real button rather than shown raw:
          an unstyled "Choose File / No file chosen" is the one element on the
          screen that does not belong to this app. */}
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
        <button
          className="btn-secondary"
          type="button"
          disabled={busy !== null}
          onClick={() => archiveInput.current?.click()}
        >
          {busy === "zip" ? "Reading…" : "Import a ZIP…"}
        </button>
      </div>

      {hasShell && <LocalApiPanel />}

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
  const settled = conflicts.filter(
    (entry) => (resolutions[entry.entity.path] ?? "keep") !== "keep",
  ).length;
  const writable = diff.counts.created + diff.counts.updated + settled;

  return (
    <div className="field">
      <p className="muted">
        {diff.counts.created} new · {diff.counts.updated} changed · {diff.counts.unchanged}{" "}
        unchanged · {diff.counts.conflict} conflict{diff.counts.conflict === 1 ? "" : "s"}
        {diff.skipped?.length ? ` · ${diff.skipped.length} file(s) skipped as unsafe` : ""}
      </p>

      {conflicts.length > 0 && (
        <ul className="wiki-lint-list">
          {conflicts.slice(0, 10).map((entry, index) => {
            const path = entry.entity.path;
            const chosen = resolutions[path] ?? "keep";
            const choose = (resolution: ConflictResolution) =>
              setResolutions((current) => ({ ...current, [path]: resolution }));
            return (
              <li key={`${path}-${index}`} data-severity="error">
                {entry.reason ?? path}
                <div className="screen-actions">
                  <button
                    className={chosen === "keep" ? "btn-secondary" : "btn-ghost"}
                    type="button"
                    aria-pressed={chosen === "keep"}
                    onClick={() => choose("keep")}
                  >
                    Keep this app&apos;s copy
                  </button>
                  {/* Not offered for a type mismatch: the id in the file names a
                      paper or an experiment, so there is no note to write over. */}
                  {entry.kind !== "type-mismatch" && (
                    <button
                      className={chosen === "folder" ? "btn-secondary" : "btn-ghost"}
                      type="button"
                      aria-pressed={chosen === "folder"}
                      onClick={() => choose("folder")}
                    >
                      Take the folder&apos;s copy
                    </button>
                  )}
                  <button
                    className={chosen === "both" ? "btn-secondary" : "btn-ghost"}
                    type="button"
                    aria-pressed={chosen === "both"}
                    onClick={() => choose("both")}
                  >
                    Keep both
                  </button>
                </div>
                {chosen === "both" && (
                  <p className="muted jump-to-meta">
                    Imported as “{keepBothTitle(entry.entity.title)}”, leaving this app&apos;s
                    copy as it is.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="error">{error}</p>}

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
