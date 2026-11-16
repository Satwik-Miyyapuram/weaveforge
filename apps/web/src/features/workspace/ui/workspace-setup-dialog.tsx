"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { Modal, ModalActions } from "@/components/modal";
import { formatError } from "@/lib/format-error";
import { chooseDesktopFolder, skipDesktopFolder } from "../application/workspace-folder";
import { firstRunQuestion } from "../application/workspace-setup";

/** The question's body; `aria-describedby` points the Choose button at it. */
const BODY_ID = "workspace-setup-body";

/**
 * The question's body, without the dialog frame so it can be rendered on its
 * own. `defaultFolder` null means the shell found no Documents folder, so Skip
 * is not offered. `notice` is a folder that was connected with a warning: the
 * question stays up, with that warning, until Continue.
 */
export function WorkspaceSetupView({
  defaultFolder,
  busy,
  error,
  notice = null,
  onChoose,
  onSkip,
  onContinue = () => {},
}: {
  defaultFolder: string | null;
  busy: boolean;
  error: string | null;
  notice?: string | null;
  onChoose: () => void;
  onSkip: () => void;
  onContinue?: () => void;
}) {
  return (
    <>
      <p id={BODY_ID} className="muted">
        Your notes, papers and drawings are saved as ordinary files in one folder you can open in any app.
        Pick the folder.
      </p>
      {defaultFolder ? <p className="muted jump-to-meta">Skip uses {defaultFolder}</p> : null}
      <p role="status" aria-live="polite" className="muted">
        {notice ?? (busy ? "Choosing…" : "")}
      </p>
      <FormError reportable={false}>{error}</FormError>
      <ModalActions>
        {notice ? (
          <Button variant="primary" onClick={onContinue}>
            Continue
          </Button>
        ) : (
          <>
            {defaultFolder ? (
              <Button disabled={busy} onClick={onSkip}>
                Skip
              </Button>
            ) : null}
            <Button
              variant="primary"
              data-autofocus
              aria-busy={busy}
              aria-describedby={BODY_ID}
              onClick={() => {
                if (!busy) onChoose();
              }}
            >
              {busy ? "Choosing…" : "Choose folder…"}
            </Button>
          </>
        )}
      </ModalActions>
    </>
  );
}

/**
 * One answer to the question. A cancelled dialog changes nothing and keeps the
 * question; a folder connected cleanly closes it; a folder connected with
 * warnings keeps it open so the warnings are read before it goes.
 */
export async function answerFirstRun(
  job: () => Promise<false | { warnings: readonly string[] }>,
): Promise<{ closed: boolean; warnings: readonly string[] }> {
  const done = await job();
  if (!done) return { closed: false, warnings: [] };
  return { closed: done.warnings.length === 0, warnings: done.warnings };
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
  const [notice, setNotice] = useState<string | null>(null);

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

  const answer = (job: () => Promise<false | { warnings: readonly string[] }>) => {
    setBusy(true);
    setError(null);
    answerFirstRun(job)
      .then(({ closed, warnings }) => {
        if (closed) setQuestion(null);
        else if (warnings.length > 0) setNotice(warnings.join(" "));
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
        notice={notice}
        onChoose={() => answer(() => chooseDesktopFolder({}))}
        onSkip={() => answer(() => skipDesktopFolder())}
        onContinue={() => setQuestion(null)}
      />
    </Modal>
  );
}
