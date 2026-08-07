"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphPersistedState, GraphViewSettings } from "@weaveforge/core";
import {
  DEFAULT_GRAPH_PERSISTED_STATE,
  DEFAULT_GRAPH_SETTINGS,
  mergeGraphPersistedState,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { formatError } from "@/lib/format-error";
import {
  clearLegacyGraphStorage,
  readGraphStateCache,
  readLegacyGraphPersistedState,
  writeGraphStateCache,
} from "./graph-legacy-storage";

const stateCache = new Map<string, GraphPersistedState>();

function pinnedFromRecord(record: GraphPersistedState["pinned"]): Map<string, { x: number; y: number }> {
  return new Map(Object.entries(record));
}

function pinnedToRecord(pinned: Map<string, { x: number; y: number }>): GraphPersistedState["pinned"] {
  return Object.fromEntries(pinned.entries());
}

export function useGraphPersistedState(projectId: string | null | undefined) {
  const [state, setState] = useState<GraphPersistedState>(DEFAULT_GRAPH_PERSISTED_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ready = useRef(false);
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const cached = stateCache.get(projectId) ?? readGraphStateCache(projectId);
    if (cached) {
      const next = mergeGraphPersistedState(cached);
      stateCache.set(projectId, next);
      setState(next);
      setLoading(false);
    } else {
      setState(DEFAULT_GRAPH_PERSISTED_STATE);
      setLoading(true);
    }

    (async () => {
      try {
        let stored = await getContainer().graph.getSettings(projectId);
        if (!stored) {
          const legacy = readLegacyGraphPersistedState();
          if (legacy) {
            stored = legacy;
            await getContainer().graph.saveSettings(projectId, legacy);
            clearLegacyGraphStorage();
          }
        }
        if (!active) return;
        const next = mergeGraphPersistedState(stored);
        stateCache.set(projectId, next);
        writeGraphStateCache(projectId, next);
        setState(next);
      } catch (err) {
        if (!active) return;
        setError(formatError(err));
      } finally {
        if (active) {
          setLoading(false);
          ready.current = true;
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [projectId]);

  const markDirty = useCallback(() => {
    dirty.current = true;
  }, []);

  const updateState = useCallback(
    (updater: (prev: GraphPersistedState) => GraphPersistedState) => {
      markDirty();
      setState((prev) => {
        const next = updater(prev);
        if (projectId) {
          stateCache.set(projectId, next);
          writeGraphStateCache(projectId, next);
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
      const toSave = stateCache.get(projectId) ?? state;
      void getContainer()
        .graph.saveSettings(projectId, toSave)
        .then(() => {
          dirty.current = false;
        })
        .catch((err) => setError(formatError(err)));
    }, 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, projectId, loading]);

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
