/**
 * Runs the shared contract suites against the in-memory implementations.
 * The Supabase implementations run the SAME suites — proving substitutability.
 */
import {
  runReadingListItemRepositoryContract,
  runReadingListRepositoryContract,
} from "../../../src/testing/reading-list-repository-contract.js";
import {
  InMemoryReadingListItemRepository,
  InMemoryReadingListRepository,
} from "../../../src/testing/in-memory-reading-list-repository.js";

runReadingListRepositoryContract(
  "InMemory",
  () => new InMemoryReadingListRepository(),
);
runReadingListItemRepositoryContract(
  "InMemory",
  () => new InMemoryReadingListItemRepository(),
);
