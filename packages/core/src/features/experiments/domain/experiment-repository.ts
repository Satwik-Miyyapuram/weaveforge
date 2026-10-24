/** Repository contract for experiments (DIP). */
import type {
  IReadableRepository,
  IWritableRepository,
} from "../../../shared/repository.js";
import type { Experiment, ExperimentFilter } from "./experiment.js";

/**
 * Fields an edit changes. A key present with `undefined` clears that field;
 * an absent key is left as stored.
 */
export type ExperimentPatch = Partial<Omit<Experiment, "id" | "createdAt">>;

export interface IExperimentRepository
  extends IReadableRepository<Experiment, ExperimentFilter>,
    IWritableRepository<Experiment> {
  /**
   * Write only `fields` of an existing run. Edits go through here rather than
   * `save`, so two edits in flight together cannot undo each other's field.
   */
  patch(id: string, fields: ExperimentPatch): Promise<void>;
}
