/**
 * The per-device install-097 reader for a browser or Android WebView. It reads this device's
 * storage only: no account, no server.
 *
 * Old data here: the install id 0.9.7 wrote at `.weaveforge/local/install-id` when its in-browser
 * export started. 0.9.8 never writes that file, so its presence means 0.9.7 began a move here.
 * Exported here: the 0.9.7 completion flag is set, or this device's own report
 * (`report-<installId>.json`) has a verified latest run of this device, the same rule as migrate.rs
 * `report_state_verified`. Other devices' reports, the legacy `report.json` and sync copies do not count.
 * The folder is git-ignored, so GitHub sync never brings another device's report here.
 *
 * Not found answers false. Any other read error, a malformed id or a report that is not a report
 * throws, so the guard fails open: the check cannot tell.
 */
import type { Install097OldUserPort } from "../application/install-097-guard";
import { BrowserWorkspaceFs } from "./parts";

export const INSTALL_ID_PATH = ".weaveforge/local/install-id";
/** localStorage key 0.9.7 set to "1" after a verified in-browser export. */
export const WEB_EXPORTED_KEY = "weaveforge:web-097-exported";
export const REPORT_DIR = ".weaveforge/migration-0.9.7";
export const LEGACY_REPORT_PATH = `${REPORT_DIR}/report.json`;
/** The shape 0.9.7 gave an install id. */
const ID_SHAPE = /^[A-Za-z0-9-]{8,64}$/;

export function ownReportPath(installId: string): string {
  return `${REPORT_DIR}/report-${installId}.json`;
}

export interface BrowserOldDataDeps {
  /** Reads a workspace file; throws a not-found error (ENOENT or NotFoundError) when absent. */
  readText(path: string): Promise<string>;
  /** Reads a localStorage value; null when unset. May throw (storage blocked). */
  readFlag(key: string): string | null;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  return name === "NotFoundError" || (typeof message === "string" && message.startsWith("ENOENT"));
}

/** The file text, or null when it does not exist. Other errors propagate. */
async function readIfPresent(deps: BrowserOldDataDeps, path: string): Promise<string | null> {
  try {
    return await deps.readText(path);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function readInstallId(deps: BrowserOldDataDeps): Promise<string | null> {
  const text = await readIfPresent(deps, INSTALL_ID_PATH);
  if (text === null) return null;
  const id = text.trim();
  if (!ID_SHAPE.test(id)) throw new Error("install-097: malformed install id");
  return id;
}

function flagSet(deps: BrowserOldDataDeps): boolean {
  try {
    return deps.readFlag(WEB_EXPORTED_KEY) === "1";
  } catch {
    return false;
  }
}

/** One run is complete when nothing is missing and every kind's db count equals its files count. */
function runComplete(run: Json): boolean {
  if (!Array.isArray(run.missing) || run.missing.length > 0) return false;
  if (!isObject(run.kinds) || Object.keys(run.kinds).length === 0) return false;
  return Object.values(run.kinds).every(
    (counts) => isObject(counts) && typeof counts.db === "number" && counts.db === counts.files,
  );
}

/** A run is verified when its state is `verified` and it is complete. */
function runVerified(run: Json): boolean {
  return run.state === "verified" && runComplete(run);
}

/**
 * This device's latest run across the report's runs: the one with the later `startedAt`. A tie goes to
 * the run that is not verified. A run without a matching `deviceId` is never this device's.
 */
function ownLatestRun(runs: unknown[], deviceId: string): Json | null {
  let seen: Json | null = null;
  for (const run of runs) {
    if (!isObject(run) || run.deviceId !== deviceId) continue;
    if (seen === null) {
      seen = run;
      continue;
    }
    const seenAt = typeof seen.startedAt === "string" ? seen.startedAt : "";
    const runAt = typeof run.startedAt === "string" ? run.startedAt : "";
    const tieToIncomplete = runAt === seenAt && runVerified(seen) && !runVerified(run);
    if (runAt > seenAt || tieToIncomplete) seen = run;
  }
  return seen;
}

/**
 * True when this device's own report is verified: its top-level state is one that counts (verified,
 * removing or removed) and this device's latest run is verified. False when absent or not verified.
 * Throws when unreadable or when the state is unknown.
 */
async function ownReportVerified(deps: BrowserOldDataDeps, installId: string): Promise<boolean> {
  const text = await readIfPresent(deps, ownReportPath(installId));
  if (text === null) return false;
  const report: unknown = JSON.parse(text);
  if (!isObject(report)) throw new Error("install-097: report is not an object");
  const state = report.state;
  if (state === "incomplete" || state === "none") return false;
  if (state !== "verified" && state !== "removing" && state !== "removed") {
    throw new Error("install-097: report has no known state");
  }
  const runs = Array.isArray(report.runs) ? report.runs : [];
  const own = ownLatestRun(runs, installId);
  return own !== null && runVerified(own);
}

export function createBrowserOldDataPort(deps: BrowserOldDataDeps): Install097OldUserPort {
  return {
    async oldDataHere() {
      return (await readInstallId(deps)) !== null;
    },
    async exportedHere() {
      if (flagSet(deps)) return true;
      const id = await readInstallId(deps);
      if (id === null) return false;
      return ownReportVerified(deps, id);
    },
  };
}

/** The browser default: the OPFS workspace and this origin's localStorage. Rejects when OPFS is unavailable (the gate opens). */
export async function browserOldDataPort(): Promise<Install097OldUserPort> {
  const fs = await BrowserWorkspaceFs.openOpfs();
  return createBrowserOldDataPort({
    readText: (path) => fs.readText(path),
    readFlag: (key) => globalThis.localStorage?.getItem(key) ?? null,
  });
}
