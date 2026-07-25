/**
 * Runs the shared repository contract suite against the in-memory implementation.
 * When the Supabase implementation lands, it runs the SAME suite — proving
 * substitutability.
 */
import { runLogEntryRepositoryContract } from "../src/testing/log-entry-repository-contract.js";
import { InMemoryLogEntryRepository } from "../src/testing/in-memory-log-entry-repository.js";

runLogEntryRepositoryContract("InMemory", () => new InMemoryLogEntryRepository());
