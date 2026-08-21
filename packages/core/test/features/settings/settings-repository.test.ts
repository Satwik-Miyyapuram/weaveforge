import { runSettingsRepositoryContract } from "../../../src/testing/settings-repository-contract.js";
import { InMemorySettingsRepository } from "../../../src/testing/in-memory-settings-repository.js";

runSettingsRepositoryContract("InMemory", () => new InMemorySettingsRepository());
