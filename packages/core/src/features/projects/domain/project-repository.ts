/**
 * Repository contract for projects (DIP). Standard read/write; projects are not
 * themselves project-scoped (they are the scope).
 */
import type {
  IReadableRepository,
  IWritableRepository,
} from "../../../shared/repository.js";
import type { Project } from "./project.js";

export interface IProjectRepository
  extends IReadableRepository<Project, unknown>,
    IWritableRepository<Project> {}
