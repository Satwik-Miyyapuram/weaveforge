/**
 * Set on `<html>` before the first paint by the layout's boot script, so the
 * page is laid out under the bar from the start rather than jumping down once
 * the title bar mounts. `--titlebar-h` in base.css reads it.
 *
 * Kept out of desktop-title-bar.tsx: that module is "use client", and a value
 * the server layout imports from it reaches `<head>` as a lazy reference, which
 * can make hydration fail (#418).
 */
export const TITLE_BAR_BOOT_SCRIPT = `try{var w=window.weaveforge;if(w&&w.platform!=="darwin"&&typeof w.menuModel==="function")document.documentElement.setAttribute("data-titlebar","")}catch(e){}`;
