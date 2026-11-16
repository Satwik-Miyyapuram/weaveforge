"use client";

import { getContainer } from "@/bootstrap";
import { useProject } from "@/features/projects/index";
import {
  citationFormatStorageKey,
  type EditorCitationFormat,
  parseEditorCitationFormat,
} from "@/lib/parts";
import { formatError } from "@/lib/format-error";
import { readStored, readStoredJson, writeStored, writeStoredJson } from "@/lib/safe-storage";
import { buildModuleRegistry, type ModuleRegistry } from "@/registry";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// --- use-citation-format-preference ---
/**
 * Per-project cite-format memory (Phase C2). Follows the active project from
 * {@link useProject} so switching projects loads/saves the correct key.
 * SSR-safe: first render uses the wikilink default until storage is read.
 */
export function useCitationFormatPreference(): [
  EditorCitationFormat,
  (value: EditorCitationFormat) => void,
] {
  const { current } = useProject();
  const projectId = current?.id ?? null;
  const [format, setFormat] = useState<EditorCitationFormat>("wikilink");

  useEffect(() => {
    setFormat(parseEditorCitationFormat(readStored(citationFormatStorageKey(projectId))));
  }, [projectId]);

  const update = useCallback(
    (value: EditorCitationFormat) => {
      setFormat(value);
      writeStored(citationFormatStorageKey(projectId), value);
    },
    [projectId],
  );

  return [format, update];
}

// --- use-detail-view ---
/**
 * True when the current route is an individual detail view — a single paper,
 * note, or experiment — rather than a list.
 *
 * On these the sub-tab strip and the swipe-between-tabs gesture are noise: the
 * detail has its own header and Back control, and a horizontal swipe over a
 * paper should not flip the user to Lists or Graph. The shell hides that chrome
 * and disables the gesture when this is true.
 *
 * Detail state is URL-driven per feature:
 *   - papers:      /papers?paper=<id>
 *   - notes/vault: /notes?page=<id>
 *   - experiments: /experiments/<id>   (a distinct route, not the list)
 */
export function useIsDetailView(): boolean {
  const pathname = usePathname() ?? "";
  const params = useSearchParams();

  if (pathname.startsWith("/papers") && params.get("paper")) return true;
  if (pathname.startsWith("/notes") && params.get("page")) return true;
  // /experiments/<id> — a segment after the base path. The bare list is
  // "/experiments" (optionally with a query string), never "/experiments/".
  if (/^\/experiments\/[^/?#]+/.test(pathname)) return true;

  return false;
}

// --- use-nav-groups ---
/**
 * The module registry, built once per mount instead of once per component.
 *
 * Three shell components — the tab bar, the sub-tab strip and the swipe
 * gesture — each carried the same `useMemo(() => buildModuleRegistry(
 * getContainer().integrationConfig), [])`. The computation is pure and its
 * input cannot change without a reload, so building it three times bought
 * nothing but three copies of the wiring to keep in step; the copy is also how
 * the three would drift if the registry ever needed an argument.
 *
 * The memo has an empty dependency list on purpose, matching what it replaced:
 * `integrationConfig` is fixed at container construction, so it is a constant
 * for the life of the page and re-reading it per render would only add work.
 *
 * `getContainer()` during render is safe by contract here and the contract is
 * worth stating: these components only mount inside `AppShell`, below
 * `PrivacyDisclaimerGate`, which is what calls `ensureContainer()`. Nothing
 * that renders above that gate may call this hook.
 */
export function useModuleRegistry(): ModuleRegistry {
  return useMemo(() => buildModuleRegistry(getContainer().integrationConfig), []);
}

/** The grouped nav items alone, for the components that only read those. */
export function useNavGroups(): ModuleRegistry["navGroups"] {
  return useModuleRegistry().navGroups;
}

// --- use-persisted-state ---
/**
 * `key` for one project: a filter saved in project A is not one in project B.
 * With no project chosen the plain key stands.
 */
export function projectScopedKey(key: string, projectId: string | null | undefined): string {
  return projectId ? `${key}.${projectId}` : key;
}

/**
 * useState that persists to localStorage under `key` (JSON). SSR-safe: the
 * server and first client render use `initial`; the stored value is applied in
 * an effect after mount (avoids hydration mismatch). Writes are best-effort.
 *
 * When `key` changes the value is read again from the new key, or reset to
 * `initial` when nothing is stored there. Nothing is written to a key until it
 * has been read, so the old key's value never lands under the new one.
 */
export function usePersistedState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  // Callers pass literals like `[]`, a new array each render: read it, do not
  // depend on it.
  const initialRef = useRef(initial);

  useEffect(() => {
    // JSON never parses to undefined, so undefined means "nothing usable stored".
    const stored = readStoredJson<T | undefined>(key, undefined);
    setValue(stored !== undefined ? stored : initialRef.current);
    setLoadedKey(key);
  }, [key]);

  useEffect(() => {
    if (loadedKey !== key) return;
    writeStoredJson(key, value);
  }, [key, value, loadedKey]);

  return [value, setValue];
}

// --- use-submit ---
/**
 * The shape every add/edit form in the app shares: disable while the work is in
 * flight, show whatever it threw, and never leave the button stuck on "Adding…".
 *
 * `action` throwing is how a form reports a validation failure — the message is
 * what the user sees. `submit` resolves true only when the action succeeded,
 * so a caller can close its dialog on success and keep it open on failure.
 */
export function useSubmit(action: () => Promise<void> | void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A ref, not state: a second click in the same tick must see the first one.
  const busyRef = useRef(false);

  async function submit(e?: React.FormEvent): Promise<boolean> {
    e?.preventDefault();
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(formatError(err));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return { busy, error, setError, submit };
}

// --- use-workspace-route ---
/** The editor workspace route, the one screen the shell renders full-bleed. */
export const WORKSPACE_PATH = "/workspace";

/**
 * True on the editor workspace route.
 *
 * `/workspace` is the one screen that is a workspace rather than a page: it
 * owns the whole window (a 48px icon rail, its own explorer, panes down to a
 * status bar on the bottom edge). The shell therefore changes shape there —
 * the primary nav renders as the rail, the content gets no padding and no
 * sub-nav strip, and the screen sizes itself against `100dvh` instead of
 * against a horizontal inset token.
 *
 * Deliberately reads `usePathname` rather than the nav-pending effective path:
 * the shell must not go full-bleed while a navigation *towards* `/workspace`
 * is still in flight, or the screen being left would collapse on its way out.
 */
export function useWorkspaceRoute(): boolean {
  const pathname = usePathname() ?? "";
  return pathname === WORKSPACE_PATH || pathname.startsWith(`${WORKSPACE_PATH}/`);
}
