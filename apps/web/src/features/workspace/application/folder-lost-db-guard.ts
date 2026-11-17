/** The message a sync throws while the database is one that was started empty over lost data. */
export const LOST_DB_SYNC_MESSAGE =
  "The local database was recreated empty, so the folder is not written over until the app restarts with its data.";

/**
 * True when the local database started empty over lost data (`recreatedEmpty`). Mirroring then
 * would write an empty workspace and let the removal pass delete the files of the last good one.
 */
export function folderWriteBlockedByLostDb(state: { recreatedEmpty?: boolean } | null | undefined): boolean {
  return state?.recreatedEmpty === true;
}
