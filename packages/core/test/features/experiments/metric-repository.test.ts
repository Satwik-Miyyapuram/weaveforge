/**
 * Runs the shared metric-repository contract against the in-memory implementation.
 * The Supabase implementation runs the SAME suite — proving substitutability.
 */
import { runMetricRepositoryContract } from "../../../src/testing/metric-repository-contract.js";
import { InMemoryMetricRepository } from "../../../src/testing/in-memory-metric-repository.js";

runMetricRepositoryContract("InMemory", () => new InMemoryMetricRepository());
