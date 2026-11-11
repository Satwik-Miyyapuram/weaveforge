import { runExperimentRepositoryContract } from "../../../src/testing/experiment-repository-contract.js";
import { InMemoryExperimentRepository } from "../../../src/testing/in-memory-a.js";

runExperimentRepositoryContract("InMemory", () => new InMemoryExperimentRepository());
