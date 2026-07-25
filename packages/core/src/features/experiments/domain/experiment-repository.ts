/** Repository contract for experiments (DIP). */
import type {
  IReadableRepository,
  IWritableRepository,
} from "../../../shared/repository.js";
import type { Experiment, ExperimentFilter } from "./experiment.js";

export interface IExperimentRepository
  extends IReadableRepository<Experiment, ExperimentFilter>,
    IWritableRepository<Experiment> {}
