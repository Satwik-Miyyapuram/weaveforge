import { runGraphSettingsRepositoryContract } from "../../../src/testing/graph-settings-repository-contract.js";
import { InMemoryGraphSettingsRepository } from "../../../src/testing/parts.js";

runGraphSettingsRepositoryContract(
  "InMemory",
  () => new InMemoryGraphSettingsRepository(),
);
