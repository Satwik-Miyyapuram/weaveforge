/**
 * Projects domain model — pure, no I/O. A Project scopes the whole app: every
 * paper, list, log, section, and relation belongs to exactly one project.
 */

import type { Clock, Identifiable, IdGenerator } from "../../../shared/parts.js";
import { ValidationError } from "../../../shared/errors.js";
import { rust } from "../../../shared/rust.js";

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
