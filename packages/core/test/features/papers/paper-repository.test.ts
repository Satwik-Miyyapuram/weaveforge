/**
 * Runs the shared repository contract suite against the in-memory implementation.
 * The PostgREST implementation runs the SAME suite — proving
 * substitutability.
 */
import { runPaperRepositoryContract } from "../../../src/testing/paper-repository-contract.js";
import { InMemoryPaperRepository } from "../../../src/testing/in-memory-paper-repository.js";

runPaperRepositoryContract("InMemory", () => new InMemoryPaperRepository());
