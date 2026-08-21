import { runDashboardLayoutRepositoryContract } from "../../../src/testing/dashboard-layout-repository-contract.js";
import { InMemoryDashboardLayoutRepository } from "../../../src/testing/in-memory-dashboard-layout-repository.js";

runDashboardLayoutRepositoryContract(
  "InMemory",
  () => new InMemoryDashboardLayoutRepository(),
);
