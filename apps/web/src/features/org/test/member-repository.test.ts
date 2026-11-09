import { before } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { runMemberRepositoryContract } from "@weaveforge/core/testing";
import { InMemoryMemberRepository } from "@weaveforge/core/testing";

before(async () => { await loadTestCore(); });

runMemberRepositoryContract("InMemory", (seed, currentId) => new InMemoryMemberRepository(currentId, seed));
