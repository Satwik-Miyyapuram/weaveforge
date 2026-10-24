export declare const ATTACHMENT_TITLE: string;

export interface AttachmentPaper {
  id: string;
  title: string;
  arxiv_id: string | null;
  doi: string | null;
}

export declare function findAttachmentPapers(
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>,
): Promise<{
  removable: AttachmentPaper[];
  touched: (AttachmentPaper & { why: string })[];
}>;
