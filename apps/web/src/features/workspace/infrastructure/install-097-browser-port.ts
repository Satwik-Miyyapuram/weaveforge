/**
 * The per-device install-097 reader for a browser or Android WebView. It reads this device's
 * storage only: no account, no server.
 *
 * Old data here: the install id 0.9.7 wrote at `.weaveforge/local/install-id` when its in-browser
 * export started. 0.9.8 never writes that file, so its presence means 0.9.7 began a move here.
 * Exported here: the 0.9.7 completion flag is set, or a 0.9.7 report in this browser's workspace is
 * verified. That is this device's own report (`report-<installId>.json`) or another 0.9.7 report in
 * the same folder (`report-<otherId>.json`, legacy `report.json`, sync copies): the account's rows
 * moved. The folder is git-ignored, so GitHub sync never brings another device's report here.
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
/**
 * A 0.9.7 report file name, the same rule as the 0.9.7 reader: `report.json`, `report-<id>.json` or a
 * sync copy of either. The `.bad` files 0.9.7 set aside do not match.
 */
const REPORT_NAME = /^report.*\.json$/;

export function ownReportPath(installId: string): string {
  return `${REPORT_DIR}/report-${installId}.json`;
}

export interface BrowserOldDataDeps {
  /** Reads a workspace file; throws a not-found error (ENOENT or NotFoundError) when absent. */
  readText(path: string): Promise<string>;
  /** Workspace paths of the entries in `dir`; empty when the folder is absent. */
  listPaths(dir: string): Promise<readonly string[]>;
  /** Reads a localStorage value; null when unset. May throw (storage blocked). */
  readFlag(key: string): string | null;
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

/** True when the report at `path` is verified; false when absent or not verified. Throws when unreadable. */
async function reportVerified(deps: BrowserOldDataDeps, path: string): Promise<boolean> {
  const text = await readIfPresent(deps, path);
  if (text === null) return false;
  const report: unknown = JSON.parse(text);
  if (typeof report !== "object" || report === null || Array.isArray(report)) {
    throw new Error("install-097: report is not an object");
  }
  const state = (report as { state?: unknown }).state;
  if (state === "verified") return true;
  if (state === "incomplete" || state === "none") return false;
  throw new Error("install-097: report has no known state");
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
      const own = ownReportPath(id);
      if (await reportVerified(deps, own)) return true;
      for (const path of await deps.listPaths(REPORT_DIR)) {
        const name = path.slice(path.lastIndexOf("/") + 1);
        if (path === own || !REPORT_NAME.test(name)) continue;
        if (await reportVerified(deps, path)) return true;
      }
      return false;
    },
  };
}

/** The browser default: the OPFS workspace and this origin's localStorage. Rejects when OPFS is unavailable (the gate opens). */
export async function browserOldDataPort(): Promise<Install097OldUserPort> {
  const fs = await BrowserWorkspaceFs.openOpfs();
  return createBrowserOldDataPort({
    readText: (path) => fs.readText(path),
    listPaths: async (dir) => (await fs.list(dir)).filter((entry) => entry.kind === "file").map((entry) => entry.path),
    readFlag: (key) => globalThis.localStorage?.getItem(key) ?? null,
  });
}
