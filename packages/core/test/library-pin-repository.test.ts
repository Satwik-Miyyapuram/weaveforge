/** Runs the library pin contract suite against the in-memory impl. */
import { runLibraryPinRepositoryContract } from "../src/testing/library-pin-repository-contract.js";
import { InMemoryLibraryPinRepository } from "../src/testing/in-memory-library-pin-repository.js";

runLibraryPinRepositoryContract("InMemory", () => new InMemoryLibraryPinRepository());
