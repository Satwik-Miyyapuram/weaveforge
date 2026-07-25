import { runTagRepositoryContract } from "../src/testing/tag-repository-contract.js";
import {
  InMemoryTagRepository,
  InMemoryPaperTagRepository,
} from "../src/testing/in-memory-tag-repository.js";

runTagRepositoryContract("InMemory", () => {
  const paperTags = new InMemoryPaperTagRepository();
  return { tags: new InMemoryTagRepository(paperTags), paperTags };
});
