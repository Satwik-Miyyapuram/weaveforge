import { runGraphSettingsRepositoryContract } from "../../../src/testing/graph-settings-repository-contract.js";
import { InMemoryGraphSettingsRepository } from "../../../src/testing/in-memory-graph-settings-repository.js";

runGraphSettingsRepositoryContract(
  "InMemory",
  () => new InMemoryGraphSettingsRepository(),
);
