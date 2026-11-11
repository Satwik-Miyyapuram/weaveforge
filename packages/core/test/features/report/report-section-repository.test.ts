/**
 * Runs the shared repository contract suite against the in-memory implementation.
 * The PostgREST implementation runs the SAME suite — proving substitutability.
 */
import { runReportSectionRepositoryContract } from "../../../src/testing/report-section-repository-contract.js";
import { InMemoryReportSectionRepository } from "../../../src/testing/in-memory-b.js";

runReportSectionRepositoryContract(
  "InMemory",
  () => new InMemoryReportSectionRepository(),
);
