import { runVaultPageRepositoryContract } from "../../../src/testing/vault-page-repository-contract.js";
import { InMemoryVaultPageRepository } from "../../../src/testing/in-memory-b.js";

runVaultPageRepositoryContract("InMemory", () => new InMemoryVaultPageRepository());
