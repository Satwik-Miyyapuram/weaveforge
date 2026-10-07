"use client";

import { useEffect, useState } from "react";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { useProject } from "@/features/projects";
import { onMattermostSignedOut } from "../infrastructure/mattermost-session";
import { MattermostLoginForm } from "./mattermost-login-form";

/**
 * One listener near the app root for the "session token stopped working" signal
 * a background post raises. Shows the shared dialog with re-sign-in, and on a
 * fresh token writes it back into the project's Mattermost integration.
 */
export function MattermostSignedOutHost() {
  const { current } = useProject();
  const [serverUrl, setServerUrl] = useState<string | null>(null);

  useEffect(() => onMattermostSignedOut((d) => setServerUrl(d.serverUrl)), []);

  if (!serverUrl || !current) return null;

  const projectId = current.id;

  async function saveToken(token: string) {
    const store = getContainer().sync.integrations;
    const existing = await store.get(projectId, "mattermost");
    await store.save(projectId, { ...existing, token, enabled: true });
    setServerUrl(null);
  }

  return (
    <Modal title="Signed out of Mattermost" onClose={() => setServerUrl(null)}>
      <div className="add-form">
        <p className="muted" style={{ marginTop: 0 }}>
          Your Mattermost session expired, so plan updates stopped posting. Sign
          in again to keep posting to this channel.
        </p>
        <MattermostLoginForm
          serverUrl={serverUrl}
          submitLabel="Sign in & resume"
          onToken={saveToken}
        />
      </div>
    </Modal>
  );
}
