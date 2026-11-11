import { runPaperTagRepositoryContract } from "../../../src/testing/paper-tag-repository-contract.js";
import { InMemoryPaperTagRepository } from "../../../src/testing/in-memory-b.js";

runPaperTagRepositoryContract("InMemory", () => new InMemoryPaperTagRepository());
