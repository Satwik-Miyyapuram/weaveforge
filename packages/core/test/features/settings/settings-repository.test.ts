import { runSettingsRepositoryContract } from "../../../src/testing/settings-repository-contract.js";
import { InMemorySettingsRepository } from "../../../src/testing/parts.js";

runSettingsRepositoryContract("InMemory", () => new InMemorySettingsRepository());
