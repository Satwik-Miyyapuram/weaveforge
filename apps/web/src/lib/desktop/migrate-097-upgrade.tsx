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

export type UpgradePhase = "running" | "stopped";

export interface UpgradeKindProgress {
  done: number;
  total: number;
}

/** The exporter: runs the move and reports its state. Injected; WEB-EXPORT supplies it. */
export type ExportRunner = (
  folder: string,
  onProgress: (p: Migrate097Progress) => void,
) => Promise<{ state: Migrate097StateName }>;

/**
 * Runs one upgrade pass. `verified` only when the exporter says so; a
 * throw or any other answer is `stopped`, so a failed run never wires the
 * file backend.
 */
export async function runUpgrade(
  folder: string,
  runExport: ExportRunner | null,
  onProgress: (p: Migrate097Progress) => void,
): Promise<"verified" | "stopped"> {
  if (!runExport) return "stopped";
  try {
    const reply = await runExport(folder, onProgress);
    return reply.state === "verified" ? "verified" : "stopped";
  } catch {
    return "stopped";
  }
}

/** Path of the shell's report for a folder, shown as selectable text. */
export function upgradeReportPath(folder: string): string {
  const sep = folder.includes("\\") ? "\\" : "/";
  return [folder.replace(/[\\/]+$/, ""), ".weaveforge", "migration-0.9.7", "report.json"].join(sep);
}

export type UpgradeBodyProps = {
  phase: UpgradePhase;
  progress: Record<string, UpgradeKindProgress>;
  reportPath: string;
  /** Kind names the exporter could not move; listed when the run stopped. */
  missing?: string[];
  copied: boolean;
  onCopy: () => void;
  onRetry: () => void;
  onKeepOld: () => void;
};

/** The screen's content, without the Modal shell (the Modal portals, so it is not server-rendered). */
export function Migrate097UpgradeBody({
  phase,
  progress,
  reportPath,
  missing = [],
  copied,
  onCopy,
  onRetry,
  onKeepOld,
}: UpgradeBodyProps) {
  const kinds = Object.entries(progress);
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
      <p>
        Report: <code style={{ userSelect: "text", WebkitUserSelect: "text" }}>{reportPath}</code>
      </p>
      <Button variant="secondary" onClick={onCopy}>
        {copied ? "Copied" : "Copy report path"}
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
  const [phase, setPhase] = useState<UpgradePhase>("running");
  const [progress, setProgress] = useState<Record<string, UpgradeKindProgress>>({});
  const [copied, setCopied] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const started = useRef(false);

  async function run() {
    setPhase("running");
    setProgress({});
    setMissing([]);
    const outcome = await runUpgrade(folder, runExport, (p) =>
      setProgress((prev) => ({ ...prev, [p.kind]: { done: p.done, total: p.total } })),
    );
    if (outcome === "verified") {
      onReady();
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
    void run();
    // Runs once per mount; run reads the latest folder and callbacks on that pass.
  }, [folder]);

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(upgradeReportPath(folder));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Migrate097UpgradeView
      phase={phase}
      progress={progress}
      reportPath={upgradeReportPath(folder)}
      missing={missing}
      copied={copied}
      onCopy={copyPath}
      onRetry={() => void run()}
      onKeepOld={onKeepOld}
    />
  );
}
