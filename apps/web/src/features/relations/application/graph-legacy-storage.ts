import type { GraphPersistedState } from "@weaveforge/core";
import { DEFAULT_GRAPH_PERSISTED_STATE, parseGraphPersistedState } from "@weaveforge/core";

const LEGACY_KEYS = {
  lists: "thesis.graph.lists",
  tags: "thesis.graph.tags",
  settings: "thesis.graph.settings",
  localSeed: "thesis.graph.localSeed",
  localDepth: "thesis.graph.localDepth",
} as const;

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** One-time import from pre-project-scoped localStorage keys. */
export function readLegacyGraphPersistedState(): GraphPersistedState | null {
  if (typeof window === "undefined") return null;
  const hasLegacy = Object.values(LEGACY_KEYS).some((key) => window.localStorage.getItem(key) != null);
  if (!hasLegacy) return null;

  const parsed = parseGraphPersistedState({
    settings: readJson(LEGACY_KEYS.settings),
    selectedLists: readJson(LEGACY_KEYS.lists),
    selectedTags: readJson(LEGACY_KEYS.tags),
    localSeed: readJson(LEGACY_KEYS.localSeed),
    localDepth: readJson(LEGACY_KEYS.localDepth),
  });
  return parsed ?? DEFAULT_GRAPH_PERSISTED_STATE;
}

export function clearLegacyGraphStorage(): void {
  if (typeof window === "undefined") return;
  for (const key of Object.values(LEGACY_KEYS)) {
    window.localStorage.removeItem(key);
  }
}

function graphStateCacheKey(projectId: string): string {
  return `thesis.graph.v2.${projectId}`;
}

export function readGraphStateCache(projectId: string): GraphPersistedState | null {
  return parseGraphPersistedState(readJson(graphStateCacheKey(projectId)));
}

export function writeGraphStateCache(projectId: string, state: GraphPersistedState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(graphStateCacheKey(projectId), JSON.stringify(state));
  } catch {
    /* ignore quota / private mode */
  }
}
