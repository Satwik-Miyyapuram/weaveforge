import { isMermaidFence, renderMermaidBlock } from "./mermaid-render";
import { desktop, type DesktopBridge, type DesktopMenuGroup } from "@/lib/desktop/desktop-bridge";
import { readyCore } from "@/lib/rust-core";
import { relayPath, relayUrl } from "@/lib/parts";
import { errorMessage } from "@weaveforge/core";
import type { HighlighterCore } from "shiki/core";

// --- palette-actions ---
/** The documentation site; the shell's Help menu opens the same page. */
export const DOCS_URL = "https://www.weaveforge.org/docs/";

export interface MenuPaletteAction {
  id: string;
  label: string;
}

/** The palette rows the shell's menu backs; none without a menu (browser, macOS). */
export function menuPaletteActions(groups: readonly DesktopMenuGroup[] | null): MenuPaletteAction[] {
  return readyCore().menuPaletteActions(groups ?? []);
}

export interface SettingsPaletteAction {
  key: string;
  label: string;
  path: string;
}

/**
 * Palette rows that open a desktop-only Settings section: only where the
 * bridge offers what the section sets, so a browser gets neither.
 */
export function settingsPaletteActions(bridge: DesktopBridge | null): SettingsPaletteAction[] {
  return readyCore().settingsPaletteRows(
    !!bridge && typeof bridge.setPlanWidget === "function",
    !!bridge && typeof bridge.inkAvailable === "function",
  );
}

/** Event that opens (or toggles) the keyboard shortcuts sheet, from anywhere. */
export const SHORTCUTS_EVENT = "weaveforge:shortcuts";

export type ShortcutsRequest = "open" | "toggle";

/** Ask the app-wide host to show the shortcuts sheet. */
export function requestShortcuts(how: ShortcutsRequest = "open"): void {
  window.dispatchEvent(new CustomEvent(SHORTCUTS_EVENT, { detail: how }));
}

/** Whether the sheet is open after a request: a toggle flips it, anything else opens it. */
export function nextShortcutsOpen(open: boolean, how: unknown): boolean {
  return readyCore().nextShortcutsOpen(open, typeof how === "string" ? how : undefined);
}

// --- perf-marks ---
/** User Timing measures for the speed baseline (docs/plans/speed-plan.md); off unless localStorage "wf:perf" is "1". */
const on = (() => {
  try {
    return typeof performance !== "undefined" && globalThis.localStorage?.getItem("wf:perf") === "1";
  } catch {
    return false;
  }
})();

/** A start time to hand to `perfEnd`, or null when measuring is off. */
export function perfStart(): number | null {
  return on ? performance.now() : null;
}

export function perfEnd(name: string, start: number | null, detail?: unknown): void {
  if (start === null) return;
  performance.measure(name, { start, end: performance.now(), detail });
}

/** Ends a measure once the frame after the current one has painted. */
export function perfEndAfterPaint(name: string, start: number | null, detail?: unknown): void {
  if (start === null) return;
  requestAnimationFrame(() => setTimeout(() => perfEnd(name, start, detail), 0));
}

let nav: { from: string; start: number } | null = null;

export function perfNavStart(from: string): void {
  const start = perfStart();
  if (start !== null) nav = { from, start };
}

export function perfNavEnd(to: string): void {
  if (!nav || nav.from === to) return;
  perfEndAfterPaint(`nav:${nav.from}->${to}`, nav.start);
  nav = null;
}

// --- project-context ---
/**
 * Mutable holder for the currently-selected project. A single instance is
 * created at the composition root and injected into every project-scoped
 * repository; repositories read `projectId` at query time, so switching project
 * (updating this field) re-scopes all reads/writes without rebuilding anything.
 */
export interface ProjectContext {
  projectId: string | null;
}

// --- recent-targets ---
export type RecentTargetKind = "paper" | "note" | "section";

export interface RecentTarget {
  kind: RecentTargetKind;
  id: string;
  title: string;
  href: string;
  visitedAt: string;
}

const PREFIX = "thesis.jump-recents";
const LIMIT = 15;

function key(projectId: string) {
  return `${PREFIX}.${projectId}`;
}

/** Storage is user-editable: keep only entries the jump list can use. */
function isRecentTarget(value: unknown): value is RecentTarget {
  return readyCore().isRecentTarget(value);
}

export function readRecentTargets(projectId: string | null): RecentTarget[] {
  if (!projectId || typeof localStorage === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(key(projectId)) ?? "[]");
    return Array.isArray(value) ? value.filter(isRecentTarget).slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberRecentTarget(
  projectId: string | null,
  target: Omit<RecentTarget, "visitedAt">,
): RecentTarget[] {
  if (!projectId || typeof localStorage === "undefined") return [];
  const next: RecentTarget[] = [
    { ...target, visitedAt: new Date().toISOString() },
    ...readRecentTargets(projectId).filter(
      (item) => !(item.kind === target.kind && item.id === target.id),
    ),
  ].slice(0, LIMIT);
  try {
    localStorage.setItem(key(projectId), JSON.stringify(next));
  } catch {
    // Storage is shared, finite, and sometimes switched off: Safari's private
    // mode throws, and so does a full origin. The read above is already treated
    // as fallible; recording a recent visit is not worth aborting the
    // navigation this is called from — three of its four callers do it inside
    // an effect, where a throw is a blank screen rather than a lost click.
  }
  return next;
}

/**
 * `items` with the recently opened ones moved to the front, in visit order and
 * flagged `recent`. A recent target that no longer matches an item is skipped.
 */
export function pinRecentTargets<T extends { kind: string; id: string }>(
  items: readonly T[],
  recents: readonly { kind: string; id: string }[],
): (T & { recent?: true })[] {
  // Malformed entries are skipped here, as the TS version did, so the wasm call
  // only ever sees well-formed keys.
  return readyCore().pinRecentTargets(
    items.filter((item) => isRecentTarget(item)),
    recents.filter((item) => isRecentTarget(item)),
  );
}

// --- shiki-render ---
export type ColorMode = "light" | "dark";

const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  md: "markdown",
};

let highlighterPromise: Promise<HighlighterCore> | null = null;

/* Shiki's core and engine are ~50 KB gzipped; imported here, on the first
   fence, rather than at module scope, so a note or paper without code never
   loads them with its page. */
function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([import("shiki/core"), import("shiki/engine/javascript")]).then(
      ([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
        createHighlighterCore({
          themes: [
            import("@shikijs/themes/github-light"),
            import("@shikijs/themes/github-dark"),
          ],
          langs: [
            import("@shikijs/langs/javascript"),
            import("@shikijs/langs/typescript"),
            import("@shikijs/langs/python"),
            import("@shikijs/langs/json"),
            import("@shikijs/langs/bash"),
            import("@shikijs/langs/markdown"),
            import("@shikijs/langs/yaml"),
            import("@shikijs/langs/rust"),
            import("@shikijs/langs/go"),
          ],
          engine: createJavaScriptRegexEngine(),
        }),
    );
    // A failed load is retried on the next fence, not kept as the answer.
    highlighterPromise.catch(() => {
      highlighterPromise = null;
    });
  }
  return highlighterPromise;
}

async function resolveLang(highlighter: HighlighterCore, info: string): Promise<string> {
  const raw = info.trim().split(/\s+/)[0]?.toLowerCase();
  if (!raw) return "markdown";
  const lang = LANG_ALIASES[raw] ?? raw;
  if (highlighter.getLoadedLanguages().includes(lang)) return lang;
  try {
    await highlighter.loadLanguage(lang as Parameters<HighlighterCore["loadLanguage"]>[0]);
    return lang;
  } catch {
    return "markdown";
  }
}

/** Highlight a fenced code block with Shiki (display / read mode only). */
export async function highlightCodeBlock(
  code: string,
  info: string,
  mode: ColorMode,
): Promise<string> {
  if (isMermaidFence(info)) return renderMermaidBlock(code);
  const highlighter = await getHighlighter();
  const lang = await resolveLang(highlighter, info);
  return highlighter.codeToHtml(code.replace(/\n$/, ""), {
    lang,
    theme: mode === "dark" ? "github-dark" : "github-light",
  });
}
