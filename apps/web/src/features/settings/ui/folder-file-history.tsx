"use client";

import { useState } from "react";
import type { WorkspaceCommit } from "@weaveforge/core";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import type { FileHistorySource } from "@/features/workspace/application/parts-1";
import { formatError } from "@/lib/format-error";

const LIMIT = 30;

type Props = {
  source: FileHistorySource;
  /** Writes the file back into the folder as it was at `oid`. */
  restore: (oid: string, path: string) => Promise<void>;
  /** Called after a restore, to show the import preview. */
  onRestored: () => void;
};

/** Earlier versions of one folder file: view them, or put one back. */
export function FolderFileHistory({ source, restore, onRestored }: Props) {
  const [path, setPath] = useState("");
  const [shown, setShown] = useState<{ path: string; commits: readonly WorkspaceCommit[] } | null>(null);
  const [view, setView] = useState<{ oid: string; text: string | null } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const work = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  const lookUp = () =>
    work(async () => {
      const file = path.trim();
      setView(null);
      setConfirm(null);
      setShown({ path: file, commits: await source.log(file, LIMIT) });
    });

  return (
    <div className="folder-file-history">
      <div className="field">
        <label htmlFor="folder-file-history-path">Earlier versions of a file</label>
        <input
          id="folder-file-history-path"
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="projects/thesis/notes/idea.md"
          autoComplete="off"
        />
        <p className="muted jump-to-meta">The path inside the folder. Restoring writes the file back, then shows what importing it would change.</p>
      </div>
      <div className="screen-actions screen-actions--start">
        <Button size="sm" disabled={busy || path.trim() === ""} onClick={() => void lookUp()}>
          Show versions
        </Button>
      </div>
      {error && <FormError>{error}</FormError>}
      {shown && shown.commits.length === 0 && (
        <p className="muted">{`No saved versions of ${shown.path}.`}</p>
      )}
      {shown && shown.commits.length > 0 && (
        <ul className="wiki-lint-list">
          {shown.commits.map((commit) => (
            <li key={commit.oid}>
              {commit.message}
              <span className="jump-to-meta"> · {commit.authoredAt.slice(0, 10)} </span>
              {confirm === commit.oid ? (
                <>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void work(async () => {
                        await restore(commit.oid, shown.path);
                        setConfirm(null);
                        onRestored();
                      })
                    }
                  >
                    Restore this version
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void work(async () =>
                        setView({ oid: commit.oid, text: await source.readAt(commit.oid, shown.path) }),
                      )
                    }
                  >
                    View
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(commit.oid)}>
                    Restore…
                  </Button>
                </>
              )}
              {view?.oid === commit.oid &&
                (view.text === null ? (
                  <p className="muted">This version is not text, or is too big to show.</p>
                ) : (
                  <pre className="folder-file-history-text">{view.text}</pre>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
