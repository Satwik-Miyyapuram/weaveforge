"use client";

import dynamic from "next/dynamic";

/**
 * Lazy boundary for the share dialog.
 *
 * The shell mounts `ShareDialogHost` on every route and most screens render a
 * `ShareButton`, but the dialog — with its member picker and link panel — only
 * paints once somebody asks to share. Code-splitting it keeps it out of every
 * route's first load; it arrives on the first click.
 *
 * `ShareDialog` is a named export, so the `.then` is not optional.
 */
export const ShareDialog = dynamic(() => import("./share-dialog").then((m) => m.ShareDialog), { ssr: false });
