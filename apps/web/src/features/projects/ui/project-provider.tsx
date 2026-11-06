"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Project } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { readDeviceSnapshot, writeDeviceSnapshot } from "@/lib/cache/device-snapshot";
import { clearAllScreenCaches } from "@/lib/cache/screen-cache";
import { logToApp } from "@/lib/error-report/app-log";
import { describeRejection } from "@/lib/format-error";
import { readStored, removeStored, writeStored } from "@/lib/safe-storage";

const STORAGE_KEY = "thesis.projectId";
const SNAPSHOT = "projects";

export interface ProjectState {
  projects: Project[];
  current: Project | null;
  loading: boolean;
  /**
   * True while `projects` is the list saved on this device at the last run,
   * painted before the database has started. Edits wait until it is false.
   */
  fromSnapshot?: boolean;
  setProject: (id: string | null) => void;
  refresh: () => Promise<Project[]>;
}

/**
 * Exported for tests. `useProject` throws outside a provider, but the provider
 * itself reaches for the container — so a hook test that only needs a project
 * id (the screen-data hook does) would otherwise have to build an application
 * to render one hook. Wrapping the probe in this context is the honest
 * smaller dependency: the test is asserting what the hook does with a project,
 * not how a project is chosen.
 */
export const ProjectContext = createContext<ProjectState | null>(null);

/**
 * The first project load: fetch the list, reopen the stored project if it
 * still exists, and always end the loading state. A failed fetch is logged
 * instead of being left as an unhandled rejection.
 *
 * `selected` is the project already open from the saved list: it is not
 * selected again (that would clear the screen caches twice), and it is closed
 * when the live list no longer has it.
 */
export async function loadInitialProject(io: {
  refresh: () => Promise<Project[]>;
  storedId: () => string | null;
  select: (id: string | null) => void;
  done: () => void;
  selected?: () => string | null;
}): Promise<void> {
  try {
    const list = await io.refresh();
    const stored = io.storedId();
    const open = io.selected?.() ?? null;
    if (stored && list.some((p) => p.id === stored)) {
      if (open !== stored) io.select(stored);
    } else if (open !== null) {
      io.select(null);
    }
  } catch (err) {
    logToApp({
      level: "warn",
      source: "projects",
      message: "Could not load projects",
      detail: describeRejection(err),
    });
  } finally {
    io.done();
  }
}

/**
 * Holds the list of projects and the current selection. Selecting a project
 * writes its id into the container's projectContext (re-scoping every repo) and
 * persists it to localStorage.
 */
export function ProjectProvider({ children }: { children: React.ReactNode }) {
  // On desktop and phone the list saved at the last run paints at once; the
  // live list replaces it when the database is up.
  const [saved] = useState(() => readDeviceSnapshot<Project[]>(SNAPSHOT));
  const [projects, setProjects] = useState<Project[]>(() => saved ?? []);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => saved == null);
  const [fromSnapshot, setFromSnapshot] = useState(() => saved != null);
  const selectedRef = useRef<string | null>(null);

  const apply = useCallback((id: string | null) => {
    // The background PDF run belongs to the project it started in (xstate-03).
    if (getContainer().projects.context.projectId !== id) {
      void import("@/features/search/application/auto-index-library").then((m) => m.stopAutoIndex());
    }
    clearAllScreenCaches();
    getContainer().projects.context.projectId = id;
    getContainer().projects.watchProject(id);
    // Blocked storage must not stop the switch: the choice lasts this session.
    if (id) writeStored(STORAGE_KEY, id);
    else removeStored(STORAGE_KEY);
    selectedRef.current = id;
    setCurrentId(id);
  }, []);

  const refresh = useCallback(async () => {
    const list = await getContainer().projects.listProjects();
    setProjects(list);
    writeDeviceSnapshot(SNAPSHOT, list);
    return list;
  }, []);

  useEffect(() => {
    const stored = readStored(STORAGE_KEY);
    if (stored && saved?.some((p) => p.id === stored)) apply(stored);
    void loadInitialProject({
      refresh,
      storedId: () => readStored(STORAGE_KEY),
      select: apply,
      selected: () => selectedRef.current,
      done: () => {
        setLoading(false);
        setFromSnapshot(false);
      },
    });
  }, [refresh, apply, saved]);

  const value = useMemo(() => {
    const current = projects.find((p) => p.id === currentId) ?? null;
    return { projects, current, loading, fromSnapshot, setProject: apply, refresh };
  }, [projects, currentId, loading, fromSnapshot, apply, refresh]);

  return (
    <ProjectContext.Provider value={value}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject(): ProjectState {
  const c = useContext(ProjectContext);
  if (!c) throw new Error("useProject must be used within a ProjectProvider.");
  return c;
}
