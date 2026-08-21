import { runMemberRepositoryContract } from "../../../src/testing/member-repository-contract.js";
import { InMemoryMemberRepository } from "../../../src/testing/in-memory-member-repository.js";

runMemberRepositoryContract("InMemory", (seed, currentId) => new InMemoryMemberRepository(currentId, seed));
