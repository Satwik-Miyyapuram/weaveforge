"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { Modal, ModalActions } from "@/components/modal";
import { formatError } from "@/lib/format-error";
import { chooseDesktopFolder, skipDesktopFolder } from "../application/workspace-folder";
import { firstRunQuestion } from "../application/workspace-setup";

/**
 * The question's body, without the dialog frame so it can be rendered on its
 * own. `defaultFolder` null means the shell found no Documents folder, so Skip
 * is not offered.
 */
export function WorkspaceSetupView({
  defaultFolder,
  busy,
  error,
  onChoose,
  onSkip,
}: {
  defaultFolder: string | null;
  busy: boolean;
  error: string | null;
  onChoose: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <p className="muted">
        Your notes, papers and drawings are saved as ordinary files in one folder you can open in any app.
        Pick the folder, or let WeaveForge use Documents\WeaveForge.
      </p>
      {defaultFolder ? <p className="muted jump-to-meta">Skip uses {defaultFolder}</p> : null}
      <FormError reportable={false}>{error}</FormError>
      <ModalActions>
        {defaultFolder ? (
          <Button disabled={busy} onClick={onSkip}>
            Skip
          </Button>
        ) : null}
        <Button variant="primary" disabled={busy} onClick={onChoose}>
          {busy ? "Choosing…" : "Choose folder…"}
        </Button>
      </ModalActions>
    </>
  );
}

/**
 * Asks once, on the first open, where the workspace lives. Answering (folder
 * picked or Skip) records it in the shell, so the question is not asked again.
 * Cancelling the native folder dialog keeps the question on screen.
 */
export function WorkspaceSetupDialog() {
  const [question, setQuestion] = useState<{ defaultFolder: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void firstRunQuestion().then((due) => {
      if (live) setQuestion(due);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!question) return null;

  const answer = (job: () => Promise<false | unknown>) => {
    setBusy(true);
    setError(null);
    job()
      .then((done) => {
        if (done) setQuestion(null);
      })
      .catch((err: unknown) => setError(formatError(err)))
      .finally(() => setBusy(false));
  };

  return (
    <Modal title="Where should your workspace live?" dismissible={false}>
      <WorkspaceSetupView
        defaultFolder={question.defaultFolder}
        busy={busy}
        error={error}
        onChoose={() => answer(() => chooseDesktopFolder({}))}
        onSkip={() => answer(() => skipDesktopFolder())}
      />
    </Modal>
  );
}
