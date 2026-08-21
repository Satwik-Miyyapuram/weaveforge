/**
 * Runs the shared contract suite against the in-memory implementation. The
 * Supabase implementation runs the SAME suite — proving substitutability.
 */
import { runPaperRelationRepositoryContract } from "../../../src/testing/paper-relation-repository-contract.js";
import { InMemoryPaperRelationRepository } from "../../../src/testing/in-memory-paper-relation-repository.js";

runPaperRelationRepositoryContract(
  "InMemory",
  () => new InMemoryPaperRelationRepository(),
);
