/**
 * Projects domain model — pure, no I/O. A Project scopes the whole app: every
 * paper, list, log, section, and relation belongs to exactly one project.
 */

import type { Identifiable } from "../../../shared/repository.js";
import type { Clock, IdGenerator } from "../../../shared/clock.js";

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

export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

export function createProject(
  input: NewProjectInput,
  deps: { clock: Clock; ids: IdGenerator },
): Project {
  const name = input.name?.trim();
  if (!name) throw new ProjectValidationError("Project name is required.");
  return {
    id: deps.ids.newId(),
    name,
    color: input.color,
    createdAt: deps.clock.nowIso(),
  };
}
