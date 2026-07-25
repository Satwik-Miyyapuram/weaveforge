import { runVaultPageRepositoryContract } from "../src/testing/vault-page-repository-contract.js";
import { InMemoryVaultPageRepository } from "../src/testing/in-memory-vault-page-repository.js";

runVaultPageRepositoryContract("InMemory", () => new InMemoryVaultPageRepository());
