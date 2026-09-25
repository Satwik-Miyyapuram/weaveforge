"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { FormError } from "@/components/form-error";

/**
 * Where the local database is.
 *
 * The shell resolves this per call. Shown rather than described, on the
 * principle that a database a person cannot find is one they cannot back up.
 *
 * **This used to be a heading of its own with a paragraph under it, and the
 * paragraph said the database was in the workspace folder — because for one
 * commit it was.** It is not, and the tab's opening copy still claimed "both live
 * in the folder you choose", so the same screen made both statements. It is now a
 * row in the status block, where the reader is already looking for it, and the
 * copy in one place says one thing.
 *
 * Desktop only: a browser has no local database to point at.
 */
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
      .catch(() => {
        // An older shell with no such channel: the row simply does not appear,
        // which is the same rule `LocalApiPanel` follows.
      });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/**
 * One labelled fact, so the reader can see the state of the thing before
 * deciding what to do about it.
 *
 * The tab previously opened with three paragraphs of explanation and no facts:
 * whether a folder was connected could only be inferred from which buttons were
 * on screen, and where the database actually was needed a separate heading and a
 * paragraph of its own. A definition list answers "what is true right now" at a
 * glance and gives the prose below it something to be about.
 *
 * Reuses `.account-info-grid`, the status grid the Account tab already
 * established. Its columns come from `display: contents` on a real `.account-info-row`
 * element around each pair, so this renders a `div` and not a fragment — the
 * fragment version lays out as `dt`/`dd` directly in the grid and silently loses
 * the two-column alignment.
 */
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

/**
 * Settings → Workspace.
 *
 * The tab answers three questions in the order they are asked, and says which
 * is which:
 *
 *   1. **What is true now** — a status block: connected or not, to what, where
 *      the database lives.
 *   2. **What you can do about it** — the folder chooser, or the mirror and
 *      import actions when one is connected.
 *   3. **The optional parts** — git history and the local HTTP surface.
 *
 * It used to be an undifferentiated column: three paragraphs of explanation,
 * then a database heading, then either a chooser or four buttons, then an import
 * section, then the local API. Everything sat at the same visual weight and the
 * opening copy contradicted the middle of the page — it claimed the database was
 * in the folder while the database section said it was not. The rewrite puts the
 * facts first, gives each action group a heading, and keeps one statement about
 * where the database is.
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
  const database = useDatabaseLocation();

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

  const connectedTo =
    session === null
      ? "Nothing yet"
      : session.kind === "opfs"
        ? "Browser storage"
        : "A folder on this device";

  return (
    <section
      id="settings-workspace"
      className="card add-form settings-anchor"
      role="tabpanel"
      aria-labelledby="settings-tab-workspace"
    >
      <h3 className="settings-group">Workspace</h3>

      {/*
        The status block. Facts first: every claim the rest of the tab makes is
        about one of these four rows, so they come before the buttons rather than
        being scattered through the prose.
      */}
      <dl className="account-info-grid">
        <StatusRow label="Folder">
          {connectedTo}
          {session?.git === "isomorphic" ? ", with git history" : ""}
          {session === null && hasShell ? " — choose one below" : ""}
        </StatusRow>
        {database?.dataDir && (
          <StatusRow label="Database">
            <PathValue path={database.dataDir} />
          </StatusRow>
        )}
        <StatusRow label="Mirror">
          {session === null
            ? "Idle until a folder is connected"
            : "Automatic — each edit is written out a moment later"}
        </StatusRow>
      </dl>

      {/*
        One statement about where things live, and it agrees with the rows above
        and with the docs. The database is deliberately *not* claimed to be in the
        folder: it is not, and the version of this text that said it did was
        describing a change that was reverted because it corrupted data.
      */}
      <p className="muted jump-to-meta">
        Your work is stored in the app&rsquo;s local database and mirrored to the folder as
        Markdown you can open in Obsidian, VS Code or Finder — so the folder is the copy to
        back up. The database lives in WeaveForge&rsquo;s own directory, shown above, and is
        backed up separately.{" "}
        {session === null && (
          <>
            The folder does not have to be empty: if it holds your own files, WeaveForge keeps its
            workspace in a <strong>WeaveForge</strong> folder inside it so the two never mix.
          </>
        )}
      </p>

      {error && <FormError>{error}</FormError>}
      {status && <p className="muted">{status}</p>}
      {database?.failure && <FormError>{database.failure}</FormError>}

      <h4 className="settings-group">Folder</h4>
      {!session ? (
        <div className="field">
          <p className="muted jump-to-meta">
            The connected folder is named in the File menu, which can also open it. Choosing one
            starts the mirror immediately.
          </p>
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
                className="btn-primary"
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run("desktop", async () => {
                    if (await chooseDesktopFolder({ git })) setSession(folderSession());
                  })
                }
              >
                {busy === "desktop" ? "Choosing…" : "Choose a folder…"}
              </button>
            )}
            {!hasShell && supportsDirectoryPicker() && (
              <button
                className="btn-primary"
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run("pick", async () => {
                    if (await chooseFolder({ git })) setSession(folderSession());
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
            <p className="muted jump-to-meta">
              Choosing a real folder needs a Chromium-based browser. Browser storage works
              everywhere, but the files are not visible in Finder or Explorer.
            </p>
          )}
        </div>
      ) : (
        <div className="field">
          {outside.length > 0 && (
            <p className="muted jump-to-meta">
              {outside.length === 1
                ? "One file was changed"
                : `${outside.length} files were changed`}{" "}
              in this folder by something other than WeaveForge. Nothing in the app has changed —
              use “Check for changes” below to see the difference first.
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
          <p className="muted jump-to-meta">
            The mirror keeps up on its own; “Write everything now” is for the moment before you
            open the folder in another editor, when waiting a second is not what you want.
          </p>

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
        {session && (
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
            {busy === "preview" ? "Reading…" : "Check for changes"}
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
