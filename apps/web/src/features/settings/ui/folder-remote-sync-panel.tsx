"use client";

import { useEffect, useState } from "react";
import type { DesktopVaultSync, DesktopVaultSyncAction } from "@/lib/desktop/desktop-bridge";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { formatError } from "@/lib/format-error";
import {
  describeRemoteSync,
  disconnectRemote,
  folderRemoteSync,
  forgetRemoteToken,
  pullThenPush,
  saveRemoteSyncSettings,
} from "@/features/workspace/application/parts-2";

type Choice = "keep-mine" | "take-remote" | "keep-both";

const LABELS: Record<Exclude<DesktopVaultSyncAction, "settings" | Choice>, [idle: string, busy: string]> = {
  connect: ["Connect", "Connecting…"],
  status: ["Check", "Checking…"],
  pull: ["Pull", "Pulling…"],
  push: ["Push", "Pushing…"],
};

/** Shown after a pull stops on a conflict: label, busy label, hover help. */
const CHOICES: Record<Choice, [idle: string, busy: string, help: string]> = {
  "keep-mine": ["Keep mine", "Merging…", "Pull again, keeping this machine's copy of each conflicted file."],
  "take-remote": ["Take remote", "Merging…", "Pull again, replacing each conflicted file with the remote's copy."],
  "keep-both": [
    "Keep both",
    "Merging…",
    "Pull again, keeping this machine's copy and saving the remote's beside it as “name (remote)”.",
  ],
};

/**
 * The workspace folder's git remote: URL and token, then pull and push.
 * Desktop only; the caller renders it when the shell can sync.
 */
export function FolderRemoteSyncPanel({ onPulled }: { onPulled?: () => void }) {
  const [url, setUrl] = useState("");
  // What the shell holds. Connect, Pull, Push and Check use it, not the field.
  const [savedUrl, setSavedUrl] = useState("");
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // The last pull stopped on files edited on both sides.
  const [conflict, setConflict] = useState(false);
  // The last push was turned away because the remote has commits this machine lacks.
  const [pushRejected, setPushRejected] = useState(false);

  useEffect(() => {
    let live = true;
    void folderRemoteSync("settings")
      .then((reply) => {
        if (!live) return;
        setUrl(reply.url ?? "");
        setSavedUrl(reply.url ?? "");
        setHasToken(reply.hasToken);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setStatus(null);
    try {
      await work();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(null);
    }
  }

  const act = (action: keyof typeof LABELS | Choice) =>
    run(action, async () => {
      setConflict(false);
      setPushRejected(false);
      const reply = await folderRemoteSync(action);
      settle(reply, await describeRemoteSync(reply));
    });

  const settle = (reply: DesktopVaultSync, line: string) => {
    setStatus(line);
    setConflict(reply.pull?.kind === "conflict");
    setPushRejected(reply.push?.kind === "rejected");
    if (reply.pull && (reply.pull.kind === "fast-forward" || reply.pull.kind === "merged")) onPulled?.();
  };

  const syncBoth = () =>
    run("pull-push", async () => {
      setConflict(false);
      setPushRejected(false);
      const { pulled, pushed } = await pullThenPush();
      const pullLine = await describeRemoteSync(pulled);
      if (!pushed) return settle(pulled, pullLine);
      if (pulled.pull?.kind === "fast-forward" || pulled.pull?.kind === "merged") onPulled?.();
      settle(pushed, `${pullLine} ${await describeRemoteSync(pushed)}`);
    });

  const unsaved = url.trim() !== savedUrl;

  return (
    <>
      <h4 className="settings-group">Git remote</h4>
      <p className="muted jump-to-meta">
        Push the folder to a git repository and pull it on another machine. Needs folder history on.
        Pull commits your edits first and stops, changing nothing, when a file was edited on both
        sides; then pick which copy to keep. Push never overwrites the remote. Build files, <code>node_modules</code> and files
        over 25 MB are left out.
      </p>
      <div className="field">
        <label htmlFor="git-remote-url">Repository URL (https)</label>
        <input
          id="git-remote-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://github.com/you/notes.git"
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label htmlFor="git-remote-token">Access token</label>
        <input
          id="git-remote-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={hasToken ? "Stored. Type to replace it." : "Leave empty for a public repository"}
          autoComplete="off"
        />
        <p className="muted jump-to-meta">Kept in this machine&apos;s keychain and never shown again.</p>
      </div>
      {error && <FormError>{error}</FormError>}
      <div role="status" aria-live="polite">
        {status && <p className="muted">{status}</p>}
      </div>
      {pushRejected && (
        <div className="screen-actions screen-actions--start">
          <Button
            variant="secondary"
            title="Pull the remote's commits, then push again. Stops if a file was edited on both sides."
            disabled={busy !== null}
            onClick={() => void syncBoth()}
          >
            {busy === "pull-push" ? "Pulling, then pushing…" : "Pull, then push"}
          </Button>
        </div>
      )}
      {conflict && (
        <div className="screen-actions screen-actions--start" role="group" aria-label="Settle the conflict">
          {(Object.keys(CHOICES) as Choice[]).map((choice) => (
            <Button
              key={choice}
              variant="secondary"
              title={CHOICES[choice][2]}
              disabled={busy !== null}
              onClick={() => void act(choice)}
            >
              {busy === choice ? CHOICES[choice][1] : CHOICES[choice][0]}
            </Button>
          ))}
        </div>
      )}
      <div className="screen-actions screen-actions--start">
        <Button
          disabled={busy !== null}
          onClick={() =>
            void run("save", async () => {
              const stored = await saveRemoteSyncSettings({ url, token });
              setUrl(stored);
              setSavedUrl(stored);
              if (token.trim()) setHasToken(true);
              setToken("");
              setStatus("Saved.");
            })
          }
        >
          {busy === "save" ? "Saving…" : "Save"}
        </Button>
        {hasToken && (
          <Button
            variant="ghost"
            disabled={busy !== null}
            onClick={() =>
              void run("forget", async () => {
                await forgetRemoteToken();
                setHasToken(false);
                setStatus("Token forgotten.");
              })
            }
          >
            Forget token
          </Button>
        )}
        {savedUrl && (
          <Button
            variant="ghost"
            disabled={busy !== null}
            onClick={() =>
              void run("disconnect", async () => {
                await disconnectRemote();
                setUrl("");
                setSavedUrl("");
                setHasToken(false);
                setStatus("Disconnected. The folder and its history are unchanged.");
              })
            }
          >
            Disconnect
          </Button>
        )}
        {(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((action) => (
          <Button
            key={action}
            variant="secondary"
            disabled={busy !== null || unsaved || !savedUrl}
            onClick={() => void act(action)}
          >
            {busy === action ? LABELS[action][1] : LABELS[action][0]}
          </Button>
        ))}
      </div>
      {unsaved && <p className="muted jump-to-meta">Save the URL first.</p>}
    </>
  );
}
