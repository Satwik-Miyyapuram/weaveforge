/** Shared org / privacy disclaimer copy (modal + settings footer). */

export const PRIVACY_DISCLAIMER_TITLE = "Privacy & data protection";

/**
 * The gate shows these first. Nobody reads eight paragraphs before clicking
 * accept, so lead with the points that change what a user would actually do,
 * and keep the full text one click away rather than pretending it was read.
 */
export const PRIVACY_DISCLAIMER_SUMMARY = [
  "Your papers, notes, and files are stored on the server, encrypted at rest. Access is controlled by the database: only you — and people you share with — can read a given item. Whoever operates this instance can technically read your content.",
  "Some structure (status, dates, tags, file paths) is used for dashboards and sorting and is visible to whoever runs this instance. Keep sensitive details out of tags.",
  "AI access is off until you turn it on. Overleaf-linked reports stay in Overleaf; WeaveForge fetches them only when you open a link. Deleting your account requires an email confirmation code.",
] as const;

export const PRIVACY_DISCLAIMER_PARAGRAPHS = [
  "WeaveForge stores your papers, notes, experiments, logbook, settings, and image/file blobs so you can manage your research work. Content is stored on the server with encryption at rest (the database and object storage's managed disk encryption). The data is readable by the server, so an operator with database access can technically read it. Paper PDFs are not stored by WeaveForge; Zotero and ZotMoov remain responsible for linked attachments.",
  "By default, only you can read your projects. Access is enforced by Postgres Row-Level Security: a row is returned only to its owner or to someone it has been explicitly shared with. Other people in your organization cannot see your work unless you share it. Supervisors may see milestone content for students in their supervision tree.",
  "To power dashboards, filtering, and sorting, a set of structural metadata is stored in queryable columns and is visible to whoever operates this instance: item status, publication years, dates, tags/hashtags, reading-list structure and colours, ordering fields, and internal file paths. Titles, authors, abstracts, notes, summaries, and report text are stored the same way. Avoid putting sensitive information anywhere you would not want the operator to see.",
  "When you share an item, you grant the recipient database-level read (and optionally comment/edit) access to that item. Revoking a share removes their access to future reads. Identity is your organization membership; there is no separate key exchange.",
  "The person who runs this instance (lab admin or infrastructure operator) can access the database, object storage, and server logs, and is therefore technically able to read your content. Reusable integration credentials (Zotero, GitLab, Semantic Scholar keys) are an exception: they are encrypted with a server-held key and are not exposed to the AI/MCP layer. Most provider requests are sent directly from the browser. Zotero collection listing uses a short-lived authenticated server relay because Zotero blocks browser CORS; the key is used only for that request and is not persisted.",
  "Account access is via your sign-in (password, magic link, or Google) and standard session recovery — there is no separate encryption unlock or recovery-code step. If you need an operator who is cryptographically unable to read your data, this deployment is not the right fit.",
  "Images and other supported files are kept in private object storage. Overleaf-linked report contents are an explicit exception: they remain in Overleaf, outside WeaveForge's project database, and are fetched through WeaveForge's server only when you open a linked report. Overleaf's access controls apply to that source. Preferences such as theme, dashboard layout, and graph settings are stored as account or project settings.",
  "AI/MCP access is off by default. If you enable it, only the sources and capabilities you select may be disclosed through the browser relay. Selected excerpts can be sent to the model provider used by your client, subject to that provider's privacy policy. Credentials, PDFs, unselected sources, and unrestricted database access are never sent to the model.",
  "You can delete your account at any time from Settings. Deletion requires a one-time code emailed to your account address, then typing DELETE_USER. That permanently removes your data from the app.",
] as const;
