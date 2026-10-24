"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Project } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { clearAllScreenCaches } from "@/lib/cache/screen-cache";
import { logToApp } from "@/lib/error-report/app-log";
import { describeRejection } from "@/lib/format-error";
import { readStored, removeStored, writeStored } from "@/lib/safe-storage";

const STORAGE_KEY = "thesis.projectId";

export interface ProjectState {
  projects: Project[];
  current: Project | null;
  loading: boolean;
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
 */
export async function loadInitialProject(io: {
  refresh: () => Promise<Project[]>;
  storedId: () => string | null;
  select: (id: string) => void;
  done: () => void;
}): Promise<void> {
  try {
    const list = await io.refresh();
    const stored = io.storedId();
    if (stored && list.some((p) => p.id === stored)) io.select(stored);
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
    setCurrentId(id);
  }, []);

  const refresh = useCallback(async () => {
    const list = await getContainer().projects.listProjects();
    setProjects(list);
    return list;
  }, []);

  useEffect(() => {
    void loadInitialProject({
      refresh,
      storedId: () => readStored(STORAGE_KEY),
      select: apply,
      done: () => setLoading(false),
    });
  }, [refresh, apply]);

  const value = useMemo(() => {
    const current = projects.find((p) => p.id === currentId) ?? null;
    return { projects, current, loading, setProject: apply, refresh };
  }, [projects, currentId, loading, apply, refresh]);

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
