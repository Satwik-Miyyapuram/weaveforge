import { runExperimentRepositoryContract } from "../../../src/testing/experiment-repository-contract.js";
import { InMemoryExperimentRepository } from "../../../src/testing/in-memory-experiment-repository.js";

runExperimentRepositoryContract("InMemory", () => new InMemoryExperimentRepository());
