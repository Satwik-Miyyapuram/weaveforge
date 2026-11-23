/** Server rows (PostgREST camel-case, nulls included) for the group (a) writer tests. */
export const USER = "11111111-2222-3333-4444-555555555555";
const PROJECT = "99999999-8888-7777-6666-555555555555";

/** A vault_pages row as PostgREST returns it (camel-cased), nulls included. */
export const NOTE_ROW = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  userId: USER,
  projectId: PROJECT,
  parentId: null,
  title: "Reading plan",
  body: "First line\nSecond line with [[Other note]]",
  sortOrder: 2,
  createdAt: "2026-11-01T09:00:00.123456+00:00",
  updatedAt: "2026-11-02T10:30:00+00:00",
  snapshotUpto: null,
  bodyPreview: "First line",
  serverSeq: 41,
  deletedAt: null,
  rowVersion: 3,
  pinned: null,
  folder: false,
  // 0157's column default: every server note row carries it.
  kind: "note",
};

export const CHILD_NOTE_ROW = {
  ...NOTE_ROW,
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  parentId: NOTE_ROW.id,
  title: "Week 1",
  body: "",
  sortOrder: 0,
  pinned: true,
  folder: true,
};

/** A papers row as PostgREST returns it, nulls included. */
export const PAPER_ROW = {
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  userId: USER,
  title: "Attention Is All You Need",
  authors: ["Ashish Vaswani", "Noam Shazeer"],
  year: 2017,
  venue: "NeurIPS",
  doi: "10.5555/3295222.3295349",
  arxivId: "1706.03762",
  url: "https://arxiv.org/abs/1706.03762",
  pdfPath: null,
  abstract: "The dominant sequence transduction models...",
  summary: null,
  status: "read",
  rating: 5,
  readAt: "2026-10-30",
  bibtex: null,
  metadata: { source: "arxiv" },
  createdAt: "2026-10-01T08:00:00+00:00",
  updatedAt: "2026-10-30T12:00:00.5+00:00",
  projectId: PROJECT,
  tags: ["transformers"],
  doiBidx: "x1",
  arxivBidx: "x2",
  serverSeq: 7,
  deletedAt: null,
  rowVersion: 1,
};

/** A bare paper: every optional column null, the NOT NULL ones at their defaults. */
export const BARE_PAPER_ROW = {
  ...PAPER_ROW,
  id: "bbbbbbbb-0000-4000-8000-000000000002",
  title: "Untitled draft",
  authors: [],
  year: null,
  venue: null,
  doi: null,
  arxivId: null,
  url: null,
  abstract: null,
  status: "to_read",
  rating: null,
  readAt: null,
  metadata: {},
  tags: [],
  doiBidx: null,
  arxivBidx: null,
};

function comment(id: string, extra: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    authorId: USER,
    resourceType: "paper",
    resourceId: PAPER_ROW.id,
    body: `comment ${id}`,
    createdAt: "2026-11-03T09:00:00+00:00",
    anchorQuote: null,
    anchorPrefix: null,
    anchorSuffix: null,
    parentId: null,
    resolvedAt: null,
    ...extra,
  };
}

export const COMMENT_ROWS = [
  comment("cccccccc-0000-4000-8000-000000000001", {
    anchorQuote: "sequence transduction",
    anchorPrefix: "The dominant ",
    anchorSuffix: " models",
  }),
  // A collaborator's reply on the user's paper (the source lists it with the user's own comments).
  comment("cccccccc-0000-4000-8000-000000000002", {
    authorId: "77777777-0000-4000-8000-000000000007",
    parentId: "cccccccc-0000-4000-8000-000000000001",
    resolvedAt: "2026-11-04T09:00:00+00:00",
  }),
  comment("cccccccc-0000-4000-8000-000000000003", { resourceType: "vault_page", resourceId: NOTE_ROW.id }),
  // A log entry has no group (a) item file: the comment lands in the fallback file.
  comment("cccccccc-0000-4000-8000-000000000004", {
    resourceType: "log_entry",
    resourceId: "dddddddd-0000-4000-8000-000000000001",
  }),
];
