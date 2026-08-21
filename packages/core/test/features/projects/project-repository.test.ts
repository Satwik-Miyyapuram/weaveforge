import { runProjectRepositoryContract } from "../../../src/testing/project-repository-contract.js";
import { InMemoryProjectRepository } from "../../../src/testing/in-memory-project-repository.js";

runProjectRepositoryContract("InMemory", () => new InMemoryProjectRepository());
