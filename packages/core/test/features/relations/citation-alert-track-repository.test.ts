import { runCitationAlertTrackRepositoryContract } from "../../../src/testing/citation-alert-track-repository-contract.js";
import { InMemoryCitationAlertTrackRepository } from "../../../src/testing/in-memory-citation-alert-track-repository.js";

runCitationAlertTrackRepositoryContract(
  "InMemory",
  () => new InMemoryCitationAlertTrackRepository(),
);
