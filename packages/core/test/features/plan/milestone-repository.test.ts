import { runMilestoneRepositoryContract } from "../../../src/testing/milestone-repository-contract.js";
import { InMemoryMilestoneRepository } from "../../../src/testing/parts.js";

runMilestoneRepositoryContract("InMemory", () => new InMemoryMilestoneRepository());
