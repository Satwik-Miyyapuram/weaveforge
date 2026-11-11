import { runProjectRepositoryContract } from "../../../src/testing/project-repository-contract.js";
import { InMemoryProjectRepository } from "../../../src/testing/parts.js";

runProjectRepositoryContract("InMemory", () => new InMemoryProjectRepository());
