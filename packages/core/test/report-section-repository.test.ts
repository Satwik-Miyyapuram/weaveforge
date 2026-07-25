/**
 * Runs the shared repository contract suite against the in-memory implementation.
 * The Supabase implementation runs the SAME suite — proving substitutability.
 */
import { runReportSectionRepositoryContract } from "../src/testing/report-section-repository-contract.js";
import { InMemoryReportSectionRepository } from "../src/testing/in-memory-report-section-repository.js";

runReportSectionRepositoryContract(
  "InMemory",
  () => new InMemoryReportSectionRepository(),
);
