import { readDeviceSnapshot, writeDeviceSnapshot } from "@/lib/cache/parts";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { removeStored } from "@/lib/safe-storage";

/**
 * The last screens' markup, kept on this device so a cold start can paint the
 * screen the person was on before the core and the database are up. Shown
 * read-only (`app/boot-snapshot.tsx`) and replaced by the live screen.
 *
 * A device snapshot (`readDeviceSnapshot`): desktop only, cleared at sign-out
 * with every other `weaveforge.` key. Kept for one user and one project at a
 * time, and for one build of the stylesheets, since the markup is only right
 * with the CSS it was drawn with. Anything in doubt reads as a miss.
 */
const NAME = "boot";
export const BOOT_SNAPSHOT_KEY = `weaveforge.snapshot.${NAME}`;
const VERSION = 1;
/** Characters of markup per screen. A bigger screen is not kept at all. */
export const MAX_SNAPSHOT_HTML = 150_000;
const MAX_SCREENS = 3;

interface BootScreen {
  path: string;
  html: string;
}

interface BootRecord {
  v: number;
  build: string;
  userId: string;
  projectId: string;
  /** Newest last. */
  screens: BootScreen[];
}

/** One name per screen: no trailing slash, and `/` is the dashboard it opens. */
export function screenPath(pathname: string): string {
  const path = pathname.replace(/\/+$/, "");
  return path === "" ? "/dashboard" : path;
}

function isRecord(value: unknown): value is BootRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<BootRecord>;
  return (
    r.v === VERSION &&
    typeof r.build === "string" &&
    typeof r.userId === "string" &&
    typeof r.projectId === "string" &&
    Array.isArray(r.screens) &&
    r.screens.every((s) => s && typeof s.path === "string" && typeof s.html === "string")
  );
}

function readRecord(): BootRecord | null {
  const value = readDeviceSnapshot<unknown>(NAME);
  return isRecord(value) ? value : null;
}

/** The saved markup for this screen, and whose it was; null on any doubt. */
export function readBootSnapshot(at: {
  build: string;
  projectId: string | null;
  path: string;
}): { html: string; userId: string } | null {
  const record = readRecord();
  if (!record || record.build !== at.build || record.projectId !== at.projectId) return null;
  const path = screenPath(at.path);
  const screen = record.screens.find((s) => s.path === path);
  return screen ? { html: screen.html, userId: record.userId } : null;
}

/** Keep this screen's markup; false when it was not kept (too big, or not the desktop app). */
export function saveBootSnapshot(at: {
  build: string;
  userId: string;
  projectId: string;
  path: string;
  html: string;
}): boolean {
  const path = screenPath(at.path);
  const prev = readRecord();
  const same = prev && prev.build === at.build && prev.userId === at.userId && prev.projectId === at.projectId;
  const screens = same ? prev.screens.filter((s) => s.path !== path) : [];
  const fits = at.html.length <= MAX_SNAPSHOT_HTML;
  if (fits) screens.push({ path, html: at.html });
  const record: BootRecord = {
    v: VERSION,
    build: at.build,
    userId: at.userId,
    projectId: at.projectId,
    screens: screens.slice(-MAX_SCREENS),
  };
  writeDeviceSnapshot(NAME, record);
  return fits && desktop() !== null;
}

export function forgetBootSnapshot(): void {
  removeStored(BOOT_SNAPSHOT_KEY);
}

/** A short key for this build's stylesheets: their names are content hashes. */
export function styleBuildKey(hrefs: readonly string[]): string {
  // FNV-1a, 32-bit. Not security: only "is this the same CSS".
  let hash = 0x811c9dc5;
  const text = hrefs.join("\n");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hrefs.length}-${hash.toString(36)}`;
}
