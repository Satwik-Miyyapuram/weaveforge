"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { Project } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { clearAllScreenCaches } from "@/lib/cache/screen-cache";
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
 * Holds the list of projects and the current selection. Selecting a project
 * writes its id into the container's projectContext (re-scoping every repo) and
 * persists it to localStorage.
 */
export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const apply = useCallback((id: string | null) => {
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
    (async () => {
      try {
        const list = await refresh();
        const stored = readStored(STORAGE_KEY);
        if (stored && list.some((p) => p.id === stored)) apply(stored);
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh, apply]);

  const current = projects.find((p) => p.id === currentId) ?? null;

  return (
    <ProjectContext.Provider value={{ projects, current, loading, setProject: apply, refresh }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject(): ProjectState {
  const c = useContext(ProjectContext);
  if (!c) throw new Error("useProject must be used within a ProjectProvider.");
  return c;
}
