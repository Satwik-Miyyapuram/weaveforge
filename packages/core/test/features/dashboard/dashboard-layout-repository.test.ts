import { runDashboardLayoutRepositoryContract } from "../../../src/testing/dashboard-layout-repository-contract.js";
import { InMemoryDashboardLayoutRepository } from "../../../src/testing/parts.js";

runDashboardLayoutRepositoryContract(
  "InMemory",
  () => new InMemoryDashboardLayoutRepository(),
);
