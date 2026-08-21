import { runMilestoneRepositoryContract } from "../../../src/testing/milestone-repository-contract.js";
import { InMemoryMilestoneRepository } from "../../../src/testing/in-memory-milestone-repository.js";

runMilestoneRepositoryContract("InMemory", () => new InMemoryMilestoneRepository());
