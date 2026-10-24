/**
 * Names of the reader's IndexedDB databases, kept apart from the stores.
 *
 * A sign-out deletes them (`clearLocalDeviceData`), and that code is reached
 * from the app layout. Importing a name from the store module itself would
 * ship the whole store to every page.
 */
export const PDF_CACHE_DB_NAME = "weaveforge-pdf-cache";
export const PAPER_HTML_DB_NAME = "weaveforge-paper-html";
