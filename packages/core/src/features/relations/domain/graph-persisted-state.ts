import {
  DEFAULT_GRAPH_SETTINGS,
  normalizeGraphViewSettings,
  type GraphViewSettings,
} from "./graph-view-settings.js";

export interface GraphPinnedPosition {
  x: number;
  y: number;
}

/** Per-project graph UI state synced across devices (stored on the project row). */
export interface GraphPersistedState {
  settings: GraphViewSettings;
  selectedLists: string[];
  selectedTags: string[];
  localSeed: string | null;
  localDepth: number;
  pinned: Record<string, GraphPinnedPosition>;
}

export const DEFAULT_GRAPH_PERSISTED_STATE: GraphPersistedState = {
  settings: DEFAULT_GRAPH_SETTINGS,
  selectedLists: [],
  selectedTags: [],
  localSeed: null,
  localDepth: 2,
  pinned: {},
};

function stringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function parsePinned(raw: unknown): Record<string, GraphPinnedPosition> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, GraphPinnedPosition> = {};
  for (const [id, pos] of Object.entries(raw as Record<string, unknown>)) {
    if (!pos || typeof pos !== "object" || Array.isArray(pos)) continue;
    const p = pos as { x?: unknown; y?: unknown };
    if (typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      out[id] = { x: p.x, y: p.y };
    }
  }
  return out;
}

/** Parse graph state JSON from persistence; returns null when payload is absent. */
export function parseGraphPersistedState(raw: unknown): GraphPersistedState | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Partial<GraphPersistedState>;
  const localDepth =
    typeof o.localDepth === "number" && Number.isFinite(o.localDepth) && o.localDepth >= 1
      ? Math.round(o.localDepth)
      : DEFAULT_GRAPH_PERSISTED_STATE.localDepth;
  return {
    settings: normalizeGraphViewSettings(o.settings),
    selectedLists: stringArray(o.selectedLists),
    selectedTags: stringArray(o.selectedTags),
    localSeed: typeof o.localSeed === "string" && o.localSeed.length > 0 ? o.localSeed : null,
    localDepth,
    pinned: parsePinned(o.pinned),
  };
}

export function mergeGraphPersistedState(stored: GraphPersistedState | null): GraphPersistedState {
  if (!stored) return structuredClone(DEFAULT_GRAPH_PERSISTED_STATE);
  return stored;
}
