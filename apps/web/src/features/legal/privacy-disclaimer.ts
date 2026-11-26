/** Shared org / privacy disclaimer copy (modal + settings footer). */

export const PRIVACY_DISCLAIMER_TITLE = "Privacy & data protection";

/**
 * The gate shows these first. Nobody reads eight paragraphs before clicking
 * accept, so lead with the points that change what a user would actually do,
 * and keep the full text one click away rather than pretending it was read.
 */
export const PRIVACY_DISCLAIMER_SUMMARY = [
  "Your work lives on your device: a local database, mirrored as files in your workspace folder. Without GitHub sync, account sync also stores your workspace on this server. With GitHub sync on, the files go to a GitHub repository you choose, and this server holds only what you share, its comments, and the AI relay. Whoever operates this instance can technically read what is on the server.",
  "On the server, structure such as status, dates, tags, and file paths is stored in plain columns for dashboards and sorting, and is visible to whoever runs this instance. Keep sensitive details out of tags.",
  "AI access is off until you turn it on. Overleaf-linked reports stay in Overleaf; WeaveForge fetches them only when you open a link. Deleting your account requires an email confirmation code.",
] as const;

export const PRIVACY_DISCLAIMER_PARAGRAPHS = [
  "WeaveForge keeps your papers, notes, experiments, logbook, and settings in a database on your device, mirrored as Markdown files in your workspace folder. If you turn on GitHub sync, those files are pushed to the GitHub repository you chose, and GitHub's privacy policy applies to them there; the WeaveForge server then receives only the items you share with others, their comments, and AI relay requests. Without GitHub sync, account sync stores your workspace on the WeaveForge server so your devices stay in step. What is on the server is readable by the server, so an operator with database access can technically read it. Paper PDFs are not stored by WeaveForge; Zotero and ZotMoov remain responsible for linked attachments.",
  "On the server, access is enforced by Postgres Row-Level Security: a row is returned only to its owner or to someone it has been explicitly shared with. Other people in your organization cannot see your work unless you share it. Supervisors can view and comment on the milestones and logbook of students in their supervision tree.",
  "To power dashboards, filtering, and sorting, rows on the server keep structural metadata in plain, queryable columns: item status, publication years, dates, tags/hashtags, reading-list structure and colours, ordering fields, and internal file paths. Titles, authors, abstracts, notes, summaries, and report text are stored the same way. All of it is visible to whoever operates this instance, so avoid putting sensitive information in anything that reaches the server.",
  "When you share an item, you grant the recipient database-level view or comment access to that item. Revoking a share removes their access to future reads. Identity is your organization membership; there is no separate key exchange.",
  "The person who runs this instance (lab admin or infrastructure operator) can access the database, object storage, and server logs, and is therefore technically able to read anything stored there. Reusable integration credentials (Zotero, GitLab, Semantic Scholar keys) are held by the server and are not exposed to the AI/MCP layer. Most provider requests are sent directly from the browser. Zotero collection listing uses a short-lived authenticated server relay because Zotero blocks browser CORS; the key is used only for that request and is not persisted.",
  "Account access is via your sign-in (password, magic link, or Google) and standard session recovery; there is no separate unlock or recovery-code step. If you need an operator who is technically unable to read your work, keep it out of the server: use GitHub sync and share only what you must, or use WeaveForge without an account.",
  "Images and other supported files you upload are kept in private object storage on the server and served only through short-lived view links. Overleaf-linked report contents are an explicit exception: they remain in Overleaf, outside WeaveForge's project database, and are fetched through WeaveForge's server only when you open a linked report. Overleaf's access controls apply to that source. Preferences such as theme, dashboard layout, and graph settings are stored as account or project settings.",
  "AI/MCP access is off by default. If you enable it, only the sources and capabilities you select may be disclosed through the browser relay. Selected excerpts can be sent to the model provider used by your client, subject to that provider's privacy policy. PDF files are never sent, but the text of a PDF you have opened in WeaveForge can be, when papers are an allowed source. Credentials, unselected sources, and unrestricted database access are never sent to the model.",
  "You can delete your account at any time from Settings. Deletion requires a one-time code emailed to your account address, then typing DELETE_USER. That permanently removes your data from the server; files in your workspace folder and your GitHub repository are yours to delete.",
] as const;

/**
 * The same subject, for a copy whose database is a file on this disk.
 *
 * Not a shortened version of the text above: almost every sentence there is
 * about a party that does not exist here — the operator, the row-level
 * policies that keep other accounts out, the share, the account deletion that
 * needs an emailed code. Showing it anyway would be the most misleading thing
 * on the screen, because a reader who takes it at face value believes their
 * work is somewhere it is not.
 */
export const PRIVACY_LOCAL_TITLE = "Your data, on this computer";

export const PRIVACY_LOCAL_PARAGRAPHS = [
  "This copy has no account and no server. Your papers, notes, experiments, logbook, settings, and files are in a database on this computer, mirrored as files in your workspace folder, and nothing in the app sends them anywhere unless you turn on one of the things below. There is no operator who can read them, because there is nobody on the other end.",
  "That cuts both ways: nothing is backed up for you, and there is no other device to fall back on. If this machine is lost or the app's data is deleted, the work is gone. Settings → Data exports everything, and the folder the app writes to can be backed up like any other, or turn on GitHub sync.",
  "Anyone who can use this computer can open the app and read the work in it. The protection here is your operating system account, not WeaveForge.",
  "Three things leave the machine when you ask them to: GitHub sync, which pushes your workspace files to the GitHub repository you chose; an AI provider you configure yourself; and an integration you connect (Zotero, GitLab, and the rest). All are off until you turn them on, and each is then subject to that provider's own privacy policy. Signing in switches this copy to an account and a server, at which point the full privacy notice applies — the local database is left where it is.",
] as const;
