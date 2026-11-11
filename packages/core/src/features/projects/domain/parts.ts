import { ValidationError } from "../../../shared/errors.js";
import type {
  Clock,
  Identifiable,
  IdGenerator,
  IReadableRepository,
  IWritableRepository,
} from "../../../shared/parts.js";
import { rust } from "../../../shared/rust.js";

// --- project ---
/**
 * Projects domain model — pure, no I/O. A Project scopes the whole app: every
 * paper, list, log, section, and relation belongs to exactly one project.
 */
export interface Project extends Identifiable {
  id: string;
  name: string;
  color?: string;
  createdAt: string;
}

export interface NewProjectInput {
  name: string;
  color?: string;
}

export class ProjectValidationError extends ValidationError {
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

export function createProject(
  input: NewProjectInput,
  deps: { clock: Clock; ids: IdGenerator },
): Project {
  const name = rust().projectName(input.name ?? "");
  if (!name) throw new ProjectValidationError("Project name is required.");
  return {
    id: deps.ids.newId(),
    name,
    color: input.color,
    createdAt: deps.clock.nowIso(),
  };
}

// --- project-repository ---
/**
 * Repository contract for projects (DIP). Standard read/write; projects are not
 * themselves project-scoped (they are the scope).
 */
export interface IProjectRepository
  extends IReadableRepository<Project, unknown>,
    IWritableRepository<Project> {}
