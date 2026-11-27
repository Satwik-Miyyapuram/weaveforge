"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { WorkspaceCommit } from "@weaveforge/core";
import { formatError } from "@/lib/format-error";
import { desktop } from "@/lib/desktop/desktop-bridge";
import {
  chooseDesktopFolder,
  chooseFolder,
  disconnectFolder,
  onOutsideEditsTakenIn,
  missingDesktopFolder,
  folderFileHistory,
  folderHistory,
  folderSession,
  restoreFolderFile,
  type FolderSession,
  supportsDirectoryPicker,
  openBrowserStorageFolder,
} from "@/features/workspace/application/workspace-folder";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/button";
import { remoteSyncAvailable } from "@/features/workspace/application/parts-2";
import { FolderRemoteSyncPanel } from "./folder-remote-sync-panel";
import { overleafSyncAvailable } from "@/features/overleaf/application/parts";
import { OverleafSyncPanel } from "./overleaf-sync-panel";
import { FolderFileHistory } from "./folder-file-history";
import { ChangeFolderAction } from "./change-folder-action";
import { folderWatchLost, onFolderWatchLost } from "@/features/workspace/application/parts";

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
  // Resolved after mount: the server has no shell, and disagreeing would be a hydration mismatch.
  const [hasShell, setHasShell] = useState(false);
  useEffect(() => setHasShell(desktop() !== null), []);
  const folderPath = useFolderPath(session);

  // The folder's commits show on open, not only after a manual write.
  useEffect(() => {
    if (!session) return;
    let live = true;
    // A history that cannot be read is a damaged repo; say so rather than show none.
    void folderHistory().then(
      (log) => live && setHistory(log),
      (err) => live && setError(`Folder history could not be read: ${formatError(err)}`),
    );
    return () => {
      live = false;
    };
  }, [session]);

  // Edits taken in with no click are still said, so nothing changes unseen.
  useEffect(
    () =>
      onOutsideEditsTakenIn((count) =>
        setStatus(`${count} outside edit${count === 1 ? "" : "s"} taken in from the folder.`),
      ),
    [],
  );
  // A watch that lost its folder (renamed, unplugged) is said, not left silent.
  useEffect(() => {
    const lost = folderWatchLost();
    if (lost) setStatus(lost);
    return onFolderWatchLost((reason) => {
      if (reason) setStatus(reason);
    });
  }, []);

  // Reconnect the folder the shell remembers, without opening a dialog. One
  // that is remembered but not there (an unplugged drive) is named, with a retry.
  const [missing, setMissing] = useState<string | null>(null);
  useEffect(() => {
    if (!hasShell || session) return;
    let live = true;
    void chooseDesktopFolder({ git: false, reuse: true })
      .then(async (adopted) => {
        if (!live) return;
        if (adopted) return setSession(folderSession());
        const gone = await missingDesktopFolder();
        if (live) setMissing(gone);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShell]);

  // Only once the folder is up; desktop needs the shell, resolved after mount.
  const fileHistory = session && (session.kind !== "desktop" || hasShell) ? folderFileHistory() : null;

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

  // Problems that did not undo a pick or a disconnect, said where the reader is looking.
  const showWarnings = (warnings: readonly string[]) => setStatus(warnings.length > 0 ? warnings.join(" ") : null);

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
      className="add-form settings-anchor"
      role="tabpanel"
      aria-labelledby="settings-tab-workspace"
    >
      <h3 className="settings-group">Workspace</h3>
      <p className="muted jump-to-meta">
        Your work is the files in this folder, as Markdown you can open in Obsidian, VS Code or Explorer.
      </p>

      <dl className="account-info-grid">
        <StatusRow label="Folder">{folderValue}</StatusRow>
      </dl>

      {error && <FormError>{error}</FormError>}
      {status && <p className="muted">{status}</p>}

      <h4 className="settings-group">Folder</h4>
      {!session ? (
        <>
          {missing && (
            <div role="alert">
              <p>
                The folder <PathValue path={missing} /> is not available. Plug its drive back in and try
                again, or choose another folder below.
              </p>
              <div className="screen-actions screen-actions--start">
                <Button
                  disabled={busy !== null}
                  onClick={() =>
                    void run("retry", async () => {
                      const back = await chooseDesktopFolder({ git: false, retry: true });
                      if (!back) return;
                      setMissing(null);
                      setSession(folderSession());
                      showWarnings(back.warnings);
                    })
                  }
                >
                  {busy === "retry" ? "Trying…" : "Try again"}
                </Button>
              </div>
            </div>
          )}
          <p className="muted jump-to-meta">
            Pick any folder; if it holds other files, WeaveForge keeps its own in a{" "}
            <strong>WeaveForge</strong> subfolder.
          </p>
          <label className="field-inline">
            <input className="wf-check"
              type="checkbox"
              checked={git}
              onChange={(e) => setGit(e.target.checked)}
            />
            Keep a local git history of the folder
          </label>
          <div className="screen-actions screen-actions--start">
            {(hasShell || supportsDirectoryPicker()) && (
              <Button
                variant="primary"
               
                disabled={busy !== null}
                onClick={() =>
                  void run("pick", async () => {
                    const picked = hasShell ? await chooseDesktopFolder({ git }) : await chooseFolder({ git });
                    if (!picked) return;
                    setMissing(null);
                    setSession(folderSession());
                    if (picked !== true) showWarnings(picked.warnings);
                  })
                }
              >
                {busy === "pick" ? "Choosing…" : "Choose a folder…"}
              </Button>
            )}
            <Button
              disabled={busy !== null}
              onClick={() =>
                void run("opfs", async () => {
                  await openBrowserStorageFolder({ git });
                  setSession(folderSession());
                })
              }
            >
              {busy === "opfs" ? "Setting up…" : "Use browser storage"}
            </Button>
          </div>
          {!hasShell && !supportsDirectoryPicker() && (
            <p className="muted jump-to-meta">Choosing a real folder needs a Chromium-based browser.</p>
          )}
        </>
      ) : (
        <>
          <div className="screen-actions screen-actions--start">
            <Button
              variant="ghost"
             
              disabled={busy !== null}
              onClick={() =>
                void run("disconnect", async () => {
                  const warnings = await disconnectFolder();
                  setSession(null);
                  setHistory([]);
                  showWarnings(warnings);
                })
              }
            >
              Disconnect
            </Button>
          </div>
          {hasShell && (
            <ChangeFolderAction
              busy={busy}
              run={run}
              onChanged={(warnings) => {
                setMissing(null);
                setSession(folderSession());
                setHistory([]);
                showWarnings(warnings);
              }}
            />
          )}
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
          {fileHistory && (
            <FolderFileHistory
              source={fileHistory}
              restore={restoreFolderFile}
              onRestored={() => void folderHistory().then(setHistory, () => undefined)}
            />
          )}
          {hasShell && session.kind === "desktop" && remoteSyncAvailable() && (
            <FolderRemoteSyncPanel onPulled={() => void folderHistory().then(setHistory, () => undefined)} />
          )}
          {hasShell && session.kind === "desktop" && overleafSyncAvailable() && (
            <OverleafSyncPanel onPulled={() => void folderHistory().then(setHistory, () => undefined)} />
          )}
        </>
      )}

    </section>
  );
}
