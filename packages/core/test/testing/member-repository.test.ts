import { InMemoryMemberRepository, runMemberRepositoryContract } from "../../src/testing/index.js";

runMemberRepositoryContract("InMemory", (seed, currentId) => new InMemoryMemberRepository(currentId, seed));
