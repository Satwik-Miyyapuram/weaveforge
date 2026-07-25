/**
 * Use-case for creating projects. Orchestration only (DIP).
 */
import { createProject, type NewProjectInput, type Project } from "../domain/project.js";
import type { IProjectRepository } from "../domain/project-repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";

export interface ManageProjectDeps {
  repository: IProjectRepository;
  clock: Clock;
  ids: IdGenerator;
}

export class ManageProjectUseCase {
  constructor(private readonly deps: ManageProjectDeps) {}
  async create(input: NewProjectInput): Promise<Project> {
    const project = createProject(input, { clock: this.deps.clock, ids: this.deps.ids });
    await this.deps.repository.save(project);
    return project;
  }
}
