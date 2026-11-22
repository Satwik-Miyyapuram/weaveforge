"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/button";
import { Modal, ModalActions } from "@/components/modal";
import { desktop } from "./desktop-bridge";
import type { Migrate097Progress, Migrate097StateName } from "./desktop-bridge";

/**
 * The 0.9.7 upgrade screen. It blocks the workspace while the TS exporter
 * moves the folder's data into files. Progress is an in-process callback. A
 * verified run hands over through `onReady`; an incomplete or failed run
 * offers Retry, or keeping the old data, which leaves the database backend in
 * use.
 */

export type UpgradePhase = "idle" | "running" | "stopped" | "verified";

export interface UpgradeKindProgress {
  done: number;
  total: number;
}

/** What the exporter reports back. The web fields are optional; the desktop answer is `state` alone. */
export type ExportReply = {
  state: Migrate097StateName;
  /** Provider names whose secret stayed on the server; the user reconnects them. */
  reconnectProviders?: string[];
  /** Server rows the web cannot decrypt; the desktop app exports them. */
  undecryptable?: number;
  /** The refusal was unsent sync outbox ops: sync pending changes first. */
  pendingSync?: boolean;
};

/** The exporter: runs the move and reports its state. Injected; WEB-EXPORT supplies it. */
export type ExportRunner = (folder: string, onProgress: (p: Migrate097Progress) => void) => Promise<ExportReply>;

/**
 * Runs one upgrade pass. `verified` only when the exporter says so; a
 * throw or any other answer is `stopped`, so a failed run never wires the
 * file backend. `onReply` receives the exporter's reply when it answers.
 */
export async function runUpgrade(
  folder: string,
  runExport: ExportRunner | null,
  onProgress: (p: Migrate097Progress) => void,
  onReply?: (reply: ExportReply) => void,
): Promise<"verified" | "stopped"> {
  if (!runExport) return "stopped";
  try {
    const reply = await runExport(folder, onProgress);
    onReply?.(reply);
    return reply.state === "verified" ? "verified" : "stopped";
  } catch {
    return "stopped";
  }
}

/**
 * The migration folder that holds the 0.9.7 reports, shown as selectable text. Each device's own
 * report file is inside it, so this screen does not name one (it does not know this device's id).
 */
export function upgradeReportFolder(folder: string): string {
  const sep = folder.includes("\\") ? "\\" : "/";
  return [folder.replace(/[\\/]+$/, ""), ".weaveforge", "migration-0.9.7"].join(sep);
}

export type UpgradeBodyProps = {
  phase: UpgradePhase;
  progress: Record<string, UpgradeKindProgress>;
  reportFolder: string;
  /** Kind names the exporter could not move; listed when the run stopped. */
  missing?: string[];
  /** Web: provider names the user reconnects to finish the upgrade. */
  reconnectProviders?: string[];
  /** Web: rows only the desktop app can export. */
  undecryptable?: number;
  /** Web: the run stopped because unsent sync changes remain. */
  pendingSync?: boolean;
  copied: boolean;
  onCopy: () => void;
  onRetry: () => void;
  onKeepOld: () => void;
  /** Web: the user presses Start; nothing is exported before that. */
  onStart?: () => void;
  /** Web: after a verified run, the user presses Continue, which reloads the app. */
  onContinue?: () => void;
};

/** The screen's content, without the Modal shell (the Modal portals, so it is not server-rendered). */
export function Migrate097UpgradeBody({
  phase,
  progress,
  reportFolder,
  missing = [],
  reconnectProviders = [],
  undecryptable = 0,
  pendingSync = false,
  copied,
  onCopy,
  onRetry,
  onKeepOld,
  onStart,
  onContinue,
}: UpgradeBodyProps) {
  const kinds = Object.entries(progress);
  if (phase === "idle") {
    return (
      <div>
        <p>Your data will move from the local database to files in this browser. Keep this tab open until it finishes.</p>
        <ModalActions>
          <Button variant="primary" onClick={onStart}>
            Start
          </Button>
        </ModalActions>
      </div>
    );
  }
  if (phase === "verified") {
    return (
      <div>
        <p>The upgrade finished. Your data is now in files.</p>
        {reconnectProviders.length > 0 ? <p>{`Reconnect ${reconnectProviders.join(", ")} to restore its sync.`}</p> : null}
        <ModalActions>
          <Button variant="primary" onClick={onContinue}>
            Continue
          </Button>
        </ModalActions>
      </div>
    );
  }
  if (phase === "running") {
    return (
      <div>
        <p>Your data is moving from the local database to files. Keep WeaveForge open until this finishes.</p>
        {kinds.length > 0 ? (
          <ul aria-label="Upgrade progress">
            {kinds.map(([kind, p]) => (
              <li key={kind}>{`${kind}: ${p.done} of ${p.total}`}</li>
            ))}
          </ul>
        ) : (
          <p>Starting…</p>
        )}
      </div>
    );
  }
  return (
    <div>
      <p>The upgrade did not finish. Your old data is untouched.</p>
      {missing.length > 0 ? <p>{`Not moved yet: ${missing.join(", ")}.`}</p> : null}
      {pendingSync ? <p>Sync pending changes first, then try again.</p> : null}
      {reconnectProviders.length > 0 ? <p>{`Reconnect ${reconnectProviders.join(", ")} to finish the upgrade.`}</p> : null}
      {undecryptable > 0 ? (
        <p>{`${undecryptable} items cannot be read here. Open the desktop app to export these ${undecryptable} items.`}</p>
      ) : null}
      <p>
        Report folder: <code style={{ userSelect: "text", WebkitUserSelect: "text" }}>{reportFolder}</code>
      </p>
      <Button variant="secondary" onClick={onCopy}>
        {copied ? "Copied" : "Copy report folder"}
      </Button>
      <ModalActions>
        <Button variant="secondary" onClick={onKeepOld}>
          Keep using old data
        </Button>
        <Button variant="primary" onClick={onRetry}>
          Retry
        </Button>
      </ModalActions>
    </div>
  );
}

export function Migrate097UpgradeView(props: UpgradeBodyProps) {
  return (
    <Modal title="Upgrading your workspace" dismissible={false}>
      <Migrate097UpgradeBody {...props} />
    </Modal>
  );
}

/** Runs the upgrade for a folder and reports progress until it verifies. */
export function Migrate097Upgrade({
  folder,
  runExport,
  onReady,
  onKeepOld,
}: {
  folder: string;
  runExport: ExportRunner | null;
  onReady: () => void;
  onKeepOld: () => void;
}) {
  // The web waits for Start; the desktop answers at once (runExport is null there) and shows Retry.
  const [phase, setPhase] = useState<UpgradePhase>(runExport ? "idle" : "running");
  const [progress, setProgress] = useState<Record<string, UpgradeKindProgress>>({});
  const [copied, setCopied] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [reply, setReply] = useState<ExportReply>({ state: "incomplete" });
  const started = useRef(false);

  async function run() {
    setPhase("running");
    setProgress({});
    setMissing([]);
    setReply({ state: "incomplete" });
    const outcome = await runUpgrade(
      folder,
      runExport,
      (p) => setProgress((prev) => ({ ...prev, [p.kind]: { done: p.done, total: p.total } })),
      setReply,
    );
    if (outcome === "verified") {
      setPhase("verified");
      return;
    }
    setPhase("stopped");
    try {
      const status = await desktop()?.migrate097Status?.(folder);
      if (Array.isArray(status?.missing)) setMissing(status.missing.filter((k) => typeof k === "string"));
    } catch {
      // Without the list the screen still offers Retry and Keep using old data.
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Only the desktop path (no runner) runs on mount; the web export waits for Start.
    if (!runExport) void run();
    // Runs once per mount; run reads the latest folder and callbacks on that pass.
  }, [folder]);

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(upgradeReportFolder(folder));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Migrate097UpgradeView
      phase={phase}
      progress={progress}
      reportFolder={upgradeReportFolder(folder)}
      missing={missing}
      reconnectProviders={reply.reconnectProviders}
      undecryptable={reply.undecryptable}
      pendingSync={reply.pendingSync}
      copied={copied}
      onCopy={copyPath}
      onRetry={() => void run()}
      onKeepOld={onKeepOld}
      onStart={() => void run()}
      onContinue={onReady}
    />
  );
}
