/** Runs the sharing + comment contract suites against the in-memory impls. */
import {
  runCommentRepositoryContract,
  runShareRepositoryContract,
} from "../../../src/testing/sharing-repository-contract.js";
import { InMemoryShareRepository } from "../../../src/testing/in-memory-b.js";
import { InMemoryCommentRepository } from "../../../src/testing/in-memory-a.js";

runShareRepositoryContract("InMemory", () => new InMemoryShareRepository("me"));
runCommentRepositoryContract("InMemory", () => new InMemoryCommentRepository("me"));
