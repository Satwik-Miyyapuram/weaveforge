"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphPersistedState, GraphViewSettings } from "@weaveforge/core";
import {
  DEFAULT_GRAPH_PERSISTED_STATE,
  DEFAULT_GRAPH_SETTINGS,
  mergeGraphPersistedState,
} from "@weaveforge/core";
import { getContainer, type AppContainer } from "@/bootstrap";
import { formatError } from "@/lib/format-error";
import {
  clearLegacyGraphStorage,
  readGraphStateCache,
  readLegacyGraphPersistedState,
  writeGraphStateCache,
} from "./graph-legacy-storage";

// The graph state lives in the graph settings repository (memoized like every
// repository) and, for a first paint without a loader, in localStorage. No
// module copy: localStorage already paints a remount, survives a reload, and is
// wiped on sign-out, which a module Map never was.

function pinnedFromRecord(record: GraphPersistedState["pinned"]): Map<string, { x: number; y: number }> {
  return new Map(Object.entries(record));
}

function pinnedToRecord(pinned: Map<string, { x: number; y: number }>): GraphPersistedState["pinned"] {
  return Object.fromEntries(pinned.entries());
}

/** Where the graph settings are stored; the app container's by default. */
export type GraphSettingsStore = Pick<AppContainer["graph"], "getSettings" | "saveSettings">;

const containerGraph: GraphSettingsStore = {
  getSettings: (projectId) => getContainer().graph.getSettings(projectId),
  saveSettings: (projectId, state) => getContainer().graph.saveSettings(projectId, state),
};

export function useGraphPersistedState(
  projectId: string | null | undefined,
  graph: GraphSettingsStore = containerGraph,
) {
  const [state, setState] = useState<GraphPersistedState>(DEFAULT_GRAPH_PERSISTED_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ready = useRef(false);
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The latest edit, with the project it was made in, for the save on leave.
  const lastEdit = useRef<{ projectId: string; state: GraphPersistedState } | null>(null);

  useEffect(() => {
    ready.current = false;
    dirty.current = false;
    setError(null);

    if (!projectId) {
      setState(DEFAULT_GRAPH_PERSISTED_STATE);
      setLoading(false);
      return;
    }

    let active = true;
    const cached = readGraphStateCache(projectId);
    if (cached) {
      setState(mergeGraphPersistedState(cached));
      setLoading(false);
    } else {
      setState(DEFAULT_GRAPH_PERSISTED_STATE);
      setLoading(true);
    }

    (async () => {
      try {
        let stored = await graph.getSettings(projectId);
        if (!stored) {
          const legacy = readLegacyGraphPersistedState();
          if (legacy) {
            stored = legacy;
            await graph.saveSettings(projectId, legacy);
            clearLegacyGraphStorage();
          }
        }
        if (!active) return;
        const next = mergeGraphPersistedState(stored);
        writeGraphStateCache(projectId, next);
        setState(next);
        // Only a load that went through lets edits save: after a failed one
        // the shown state is a cache or the defaults, and saving it would
        // overwrite the stored settings (26-01).
        ready.current = true;
      } catch (err) {
        if (!active) return;
        setError(formatError(err));
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [projectId, graph]);

  const markDirty = useCallback(() => {
    dirty.current = true;
  }, []);

  const updateState = useCallback(
    (updater: (prev: GraphPersistedState) => GraphPersistedState) => {
      markDirty();
      setState((prev) => {
        const next = updater(prev);
        if (projectId) {
          writeGraphStateCache(projectId, next);
          lastEdit.current = { projectId, state: next };
        }
        return next;
      });
    },
    [markDirty, projectId],
  );

  useEffect(() => {
    if (!projectId || !ready.current || loading || !dirty.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void graph
        .saveSettings(projectId, state)
        .then(() => {
          dirty.current = false;
        })
        .catch((err) => setError(formatError(err)));
    }, 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, projectId, loading, graph]);

  // On unmount or a project switch, save an edit still waiting on the
  // debounce, to the project it was made in (26-02). Not in the effect above,
  // whose cleanup runs on every edit.
  useEffect(() => {
    return () => {
      if (!projectId || !ready.current || !dirty.current) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      const toSave = lastEdit.current;
      if (toSave?.projectId === projectId) void graph.saveSettings(projectId, toSave.state).catch(() => {});
    };
  }, [projectId, graph]);

  const settings = useMemo(
    () => ({
      ...DEFAULT_GRAPH_SETTINGS,
      ...state.settings,
      relationTypes: state.settings.relationTypes?.length
        ? state.settings.relationTypes
        : DEFAULT_GRAPH_SETTINGS.relationTypes,
    }),
    [state.settings],
  );

  const patchSettings = useCallback(
    (patch: Partial<GraphViewSettings>) => {
      updateState((prev) => ({
        ...prev,
        settings: { ...prev.settings, ...patch },
      }));
    },
    [updateState],
  );

  const setSelectedLists = useCallback(
    (lists: string[]) => updateState((prev) => ({ ...prev, selectedLists: lists })),
    [updateState],
  );

  const setSelectedTags = useCallback(
    (tags: string[]) => updateState((prev) => ({ ...prev, selectedTags: tags })),
    [updateState],
  );

  const setLocalSeed = useCallback(
    (seed: string | null) => updateState((prev) => ({ ...prev, localSeed: seed })),
    [updateState],
  );

  const setLocalDepth = useCallback(
    (depth: number) => updateState((prev) => ({ ...prev, localDepth: depth })),
    [updateState],
  );

  const pinned = useMemo(() => pinnedFromRecord(state.pinned), [state.pinned]);

  const setPinned = useCallback(
    (next: Map<string, { x: number; y: number }>) => {
      updateState((prev) => ({ ...prev, pinned: pinnedToRecord(next) }));
    },
    [updateState],
  );

  const handlePinToggle = useCallback(
    (id: string, pos: { x: number; y: number } | null) => {
      updateState((prev) => {
        const next = { ...prev.pinned };
        if (pos) next[id] = pos;
        else delete next[id];
        return { ...prev, pinned: next };
      });
    },
    [updateState],
  );

  const resetLocalGraph = useCallback(() => {
    updateState((prev) => ({
      ...prev,
      localSeed: null,
      pinned: {},
    }));
  }, [updateState]);

  return {
    loading,
    error,
    settings,
    patchSettings,
    selectedLists: state.selectedLists,
    setSelectedLists,
    selectedTags: state.selectedTags,
    setSelectedTags,
    localSeed: state.localSeed,
    setLocalSeed,
    localDepth: state.localDepth,
    setLocalDepth,
    pinned,
    setPinned,
    handlePinToggle,
    resetLocalGraph,
  };
}
