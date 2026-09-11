/**
 * The error taxonomy (review-2 F5).
 *
 * Two properties are worth a test, because both were the defect:
 *
 * 1. every feature error is an instance of exactly one of the four branches, so
 *    a caller can ask "not found, forbidden, conflicting, or invalid?" without
 *    knowing 24 class names; and
 * 2. one function decides the HTTP status, so two routes cannot disagree.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AddLogEntryUseCase,
  AiBrowserPairingRequiredError,
  AiQueryDeniedError,
  CitationAlertTrackError,
  CommentValidationError,
  ConflictError,
  ERROR_STATUS_BAD_REQUEST,
  ERROR_STATUS_CONFLICT,
  ERROR_STATUS_FORBIDDEN,
  ERROR_STATUS_INTERNAL,
  ERROR_STATUS_NOT_FOUND,
  ExperimentValidationError,
  LibraryPinError,
  LogEntryValidationError,
  ManageExperimentUseCase,
  ManageMilestoneUseCase,
  ManageReadingListUseCase,
  ManageReportSectionUseCase,
  ManageTagsUseCase,
  ManageVaultPageUseCase,
  MemberPermissionError,
  MemberValidationError,
  MetadataResolutionError,
  MilestoneValidationError,
  NotFoundError,
  OrgInviteValidationError,
  OrgNotFoundError,
  OrgPermissionError,
  OrgValidationError,
  PaperFieldValidationError,
  PaperRelationValidationError,
  PaperValidationError,
  PermissionError,
  ProjectValidationError,
  ReadingListValidationError,
  ReportSectionValidationError,
  ScreeningError,
  ShareValidationError,
  UpdatePaperUseCase,
  ValidationError,
  VectorDimensionError,
  VaultPageValidationError,
  WeaveForgeError,
  WorkspacePathError,
  httpStatusForError,
  isWeaveForgeError,
} from "../../src/index.js";
import {
  InMemoryExperimentRepository,
  InMemoryLogEntryRepository,
  InMemoryMilestoneRepository,
  InMemoryPaperRepository,
  InMemoryPaperTagRepository,
  InMemoryReadingListItemRepository,
  InMemoryReadingListRepository,
  InMemoryReportSectionRepository,
  InMemoryTagRepository,
} from "../../src/testing/index.js";
import { InMemoryVaultPageRepository } from "../../src/testing/in-memory-vault-page-repository.js";
import { fixedClock, seqIds } from "../../src/testing/fakes.js";

const clock = fixedClock();

/** Every exported legacy class, with the branch it must belong to. */
const TAXONOMY: readonly (readonly [string, new (message: string) => Error, unknown])[] = [
  ["VaultPageValidationError", VaultPageValidationError, ValidationError],
  ["LogEntryValidationError", LogEntryValidationError, ValidationError],
  ["ReportSectionValidationError", ReportSectionValidationError, ValidationError],
  ["MilestoneValidationError", MilestoneValidationError, ValidationError],
  ["PaperRelationValidationError", PaperRelationValidationError, ValidationError],
  ["ExperimentValidationError", ExperimentValidationError, ValidationError],
  ["PaperValidationError", PaperValidationError, ValidationError],
  ["PaperFieldValidationError", PaperFieldValidationError, ValidationError],
  ["ReadingListValidationError", ReadingListValidationError, ValidationError],
  ["ScreeningError", ScreeningError, ValidationError],
  ["OrgValidationError", OrgValidationError, ValidationError],
  ["OrgInviteValidationError", OrgInviteValidationError, ValidationError],
  ["MemberValidationError", MemberValidationError, ValidationError],
  ["CommentValidationError", CommentValidationError, ValidationError],
  ["ShareValidationError", ShareValidationError, ValidationError],
  ["ProjectValidationError", ProjectValidationError, ValidationError],
  ["MemberPermissionError", MemberPermissionError, PermissionError],
  ["AiQueryDeniedError", AiQueryDeniedError, PermissionError],
  ["LibraryPinError", LibraryPinError, PermissionError],
  ["MetadataResolutionError", MetadataResolutionError, WeaveForgeError],
];

test("every legacy error class keeps its name and gains a typed branch", () => {
  for (const [name, Ctor, branch] of TAXONOMY) {
    const error = new Ctor("nope");
    assert.equal(error.name, name, `${name} lost its name`);
    // Some decorate the message (`AiQueryDeniedError` prefixes "AI query denied:");
    // what matters is that the caller's text survives.
    assert.ok(error.message.includes("nope"), `${name} lost its message`);
    assert.ok(error instanceof branch, `${name} is not a ${(branch as { name: string }).name}`);
    assert.ok(error instanceof WeaveForgeError, `${name} is not a WeaveForgeError`);
    assert.ok(isWeaveForgeError(error));
  }
});

test("errors without a clear HTTP meaning still extend the root, not Error", () => {
  // These two describe a local transport precondition and a metadata fetch
  // failure: neither has a defensible status of its own, so they claim none.
  for (const error of [new AiBrowserPairingRequiredError(), new CitationAlertTrackError("x")]) {
    assert.ok(error instanceof WeaveForgeError);
    assert.equal(error instanceof ValidationError, false);
    assert.equal(error instanceof NotFoundError, false);
  }
});

test("httpStatusForError maps each branch, and nothing else guesses", () => {
  const cases: readonly (readonly [unknown, number])[] = [
    [new NotFoundError("gone"), ERROR_STATUS_NOT_FOUND],
    [new OrgNotFoundError("gone"), ERROR_STATUS_NOT_FOUND],
    [new PermissionError("no"), ERROR_STATUS_FORBIDDEN],
    [new OrgPermissionError("no"), ERROR_STATUS_FORBIDDEN],
    [new MemberPermissionError("no"), ERROR_STATUS_FORBIDDEN],
    [new ConflictError("busy"), ERROR_STATUS_CONFLICT],
    [new ValidationError("bad"), ERROR_STATUS_BAD_REQUEST],
    [new OrgValidationError("bad"), ERROR_STATUS_BAD_REQUEST],
    [new OrgInviteValidationError("bad"), ERROR_STATUS_BAD_REQUEST],
    [new VectorDimensionError(3, 4), ERROR_STATUS_BAD_REQUEST],
    [new WorkspacePathError("../etc/passwd"), ERROR_STATUS_BAD_REQUEST],
    // A bug is not a rule: anything untaxonomised is a server error.
    [new Error("boom"), ERROR_STATUS_INTERNAL],
    [new TypeError("boom"), ERROR_STATUS_INTERNAL],
    ["not even an error", ERROR_STATUS_INTERNAL],
    [undefined, ERROR_STATUS_INTERNAL],
  ];
  for (const [error, status] of cases) {
    assert.equal(httpStatusForError(error), status, String(error));
  }
});

test("the same lab condition maps to the same status, whatever throws it", () => {
  // The org routes both delegate here, which is what makes the 400-vs-403
  // contradiction impossible: this class answers one number, always.
  assert.equal(httpStatusForError(new OrgValidationError("Lab name is required.")), 400);
  assert.equal(httpStatusForError(new OrgNotFoundError("Lab not found.")), 404);
  assert.equal(
    httpStatusForError(new OrgPermissionError("Only the lab owner can regenerate codes.")),
    403,
  );
});

// --- not-found is thrown as not-found --------------------------------------

/** One missing-id call per use case that used to signal 404 as a validation error. */
const NOT_FOUND_CALLS: readonly (readonly [string, () => Promise<unknown>])[] = [
  [
    "ManageVaultPageUseCase.update",
    () =>
      new ManageVaultPageUseCase({
        repository: new InMemoryVaultPageRepository(),
        clock,
        ids: seqIds(),
      }).update("missing", { title: "x" }),
  ],
  [
    "ManageReportSectionUseCase.setStatus",
    () =>
      new ManageReportSectionUseCase({
        repository: new InMemoryReportSectionRepository(),
        clock,
        ids: seqIds(),
      }).setStatus("missing", "done"),
  ],
  [
    "ManageMilestoneUseCase.update",
    () =>
      new ManageMilestoneUseCase({
        repository: new InMemoryMilestoneRepository(),
        clock,
        ids: seqIds(),
      }).update("missing", { title: "x" }),
  ],
  [
    "ManageExperimentUseCase.setStatus",
    () =>
      new ManageExperimentUseCase({
        repository: new InMemoryExperimentRepository(),
        clock,
        ids: seqIds(),
      }).setStatus("missing", "running"),
  ],
  [
    "UpdatePaperUseCase.setStatus",
    () =>
      new UpdatePaperUseCase({
        repository: new InMemoryPaperRepository(),
        tags: new ManageTagsUseCase({
          tags: new InMemoryTagRepository(),
          paperTags: new InMemoryPaperTagRepository(),
          papers: new InMemoryPaperRepository(),
          clock,
          ids: seqIds(),
        }),
        clock,
      }).setStatus("missing", "read"),
  ],
  [
    "AddLogEntryUseCase.update",
    () =>
      new AddLogEntryUseCase({
        repository: new InMemoryLogEntryRepository(),
        clock,
        ids: seqIds(),
      }).update("missing", { body: "x", kind: "daily" }),
  ],
  [
    "ManageTagsUseCase.setManualTags",
    () =>
      new ManageTagsUseCase({
        tags: new InMemoryTagRepository(),
        paperTags: new InMemoryPaperTagRepository(),
        papers: new InMemoryPaperRepository(),
        clock,
        ids: seqIds(),
      }).setManualTags("missing", ["tag"]),
  ],
  [
    "ManageReadingListUseCase.removeList",
    () =>
      new ManageReadingListUseCase({
        lists: new InMemoryReadingListRepository(),
        items: new InMemoryReadingListItemRepository(),
        clock,
        ids: seqIds(),
      }).removeList("missing"),
  ],
];

test("a missing id throws NotFoundError, never a validation error", async () => {
  for (const [label, call] of NOT_FOUND_CALLS) {
    await assert.rejects(call(), NotFoundError, `${label} did not throw NotFoundError`);
    // And it is *only* a not-found: a route must not answer 400 for it.
    await assert.rejects(call(), (err: unknown) => {
      assert.equal(err instanceof ValidationError, false, `${label} still looks invalid`);
      assert.equal(httpStatusForError(err), ERROR_STATUS_NOT_FOUND, label);
      return true;
    });
  }
});

test("the not-found messages still name the id, for logs and toasts", async () => {
  await assert.rejects(
    () =>
      new ManageVaultPageUseCase({
        repository: new InMemoryVaultPageRepository(),
        clock,
        ids: seqIds(),
      }).update("missing", { title: "x" }),
    /No vault page with id "missing"\./,
  );
});
