"use client";

import { useEffect, useState } from "react";
import type { DesktopOverleafSync } from "@/lib/desktop/desktop-bridge";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { formatError } from "@/lib/format-error";
import {
  describeOverleafSync,
  overleafSync,
  saveOverleafToken,
} from "@/features/overleaf/application/overleaf-folder-sync";

type Link = DesktopOverleafSync["links"][number];

const ACTIONS = {
  status: ["Check", "Checking…"],
  pull: ["Pull", "Pulling…"],
  push: ["Push", "Pushing…"],
} as const;

/**
 * Overleaf projects synced into folders of the vault over Overleaf's git
 * bridge. Desktop only; the caller renders it when the shell can sync.
 */
export function OverleafSyncPanel({ onPulled }: { onPulled?: () => void }) {
  const [links, setLinks] = useState<Link[]>([]);
  const [hasToken, setHasToken] = useState(false);
  const [token, setToken] = useState("");
  const [project, setProject] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const take = (reply: DesktopOverleafSync) => {
    setLinks(reply.links);
    setHasToken(reply.hasToken);
  };

  useEffect(() => {
    let live = true;
    void overleafSync({ action: "list" })
      .then((reply) => live && take(reply))
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

  const act = (link: Link, action: keyof typeof ACTIONS) =>
    run(`${action}:${link.projectId}`, async () => {
      const reply = await overleafSync({ action, projectId: link.projectId });
      take(reply);
      setStatus(`${link.folder}: ${describeOverleafSync(reply)}`);
      if (reply.pull && (reply.pull.kind === "fast-forward" || reply.pull.kind === "merged")) onPulled?.();
    });

  return (
    <>
      <h4 className="settings-group">Overleaf projects</h4>
      <p className="muted jump-to-meta">
        Keep an Overleaf project in a folder of this vault and edit it here. Pull brings Overleaf&apos;s
        changes in; push sends yours back. Pull commits your edits first and stops, changing nothing,
        when a file was edited on both sides. Push never overwrites Overleaf. Uses Overleaf&apos;s git
        integration, so it needs a git token from Overleaf → Account settings.
      </p>
      <div className="field">
        <label htmlFor="overleaf-sync-token">Overleaf git token</label>
        <input
          id="overleaf-sync-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={hasToken ? "Stored. Type to replace it." : "olp_…"}
          autoComplete="off"
        />
        <p className="muted jump-to-meta">Kept in this machine&apos;s keychain and never shown again.</p>
      </div>
      <div className="screen-actions screen-actions--start">
        <Button
          disabled={busy !== null || !token.trim()}
          onClick={() =>
            void run("token", async () => {
              await saveOverleafToken(token);
              setToken("");
              setHasToken(true);
              setStatus("Token saved.");
            })
          }
        >
          {busy === "token" ? "Saving…" : "Save token"}
        </Button>
      </div>
      <div className="field">
        <label htmlFor="overleaf-sync-project">Project URL or id</label>
        <input
          id="overleaf-sync-project"
          type="text"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          placeholder="https://www.overleaf.com/project/…"
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label htmlFor="overleaf-sync-folder">Folder in the vault</label>
        <input
          id="overleaf-sync-folder"
          type="text"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="Overleaf/<project id>"
          autoComplete="off"
        />
      </div>
      <div className="screen-actions screen-actions--start">
        <Button
          variant="secondary"
          disabled={busy !== null || !project.trim()}
          onClick={() =>
            void run("link", async () => {
              take(await overleafSync({ action: "link", projectId: project, folder: folder.trim() || undefined }));
              setProject("");
              setFolder("");
              setStatus("Linked. Pull to bring the project in.");
            })
          }
        >
          {busy === "link" ? "Linking…" : "Link project"}
        </Button>
      </div>
      {error && <FormError>{error}</FormError>}
      {status && <p className="muted">{status}</p>}
      {links.length > 0 && (
        <ul className="wiki-lint-list">
          {links.map((link) => (
            <li key={link.projectId}>
              <p>
                <code>{link.folder}</code> <span className="muted">↔ {link.projectId}</span>
              </p>
              <div className="screen-actions screen-actions--start">
                {(Object.keys(ACTIONS) as (keyof typeof ACTIONS)[]).map((action) => (
                  <Button
                    key={action}
                    variant="secondary"
                    disabled={busy !== null || !hasToken}
                    onClick={() => void act(link, action)}
                  >
                    {busy === `${action}:${link.projectId}` ? ACTIONS[action][1] : ACTIONS[action][0]}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(`unlink:${link.projectId}`, async () => {
                      take(await overleafSync({ action: "unlink", projectId: link.projectId }));
                      setStatus(`Unlinked. The files in ${link.folder} stay where they are.`);
                    })
                  }
                >
                  Unlink
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {links.length > 0 && !hasToken && <p className="muted jump-to-meta">Save your Overleaf git token first.</p>}
    </>
  );
}
