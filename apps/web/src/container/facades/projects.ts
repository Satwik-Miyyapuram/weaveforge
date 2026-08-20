import type { IProjectRepository } from "@weaveforge/core";
import type { ManageProjectUseCase } from "@weaveforge/core";
import type { ProjectContext } from "@/lib/project-context";

export class ProjectsFacade {
  constructor(
    private readonly deps: {
      projects: IProjectRepository;
      manageProject: ManageProjectUseCase;
      context: ProjectContext;
      watchLww: (projectId: string | null) => void;
    },
  ) {}

  listProjects() {
    return this.deps.projects.list();
  }

  get manageProject() {
    return this.deps.manageProject;
  }
  get context() {
    return this.deps.context;
  }

  watchProject(projectId: string | null) {
    this.deps.watchLww(projectId);
  }
}
