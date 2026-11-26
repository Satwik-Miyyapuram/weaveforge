/**
 * Set on `<html>` before the first paint by the layout's boot script, so the
 * page is laid out under the bar from the start rather than jumping down once
 * `DesktopTitleBar` mounts. `--titlebar-h` in base.css reads it.
 */
export const TITLE_BAR_BOOT_SCRIPT = `try{var w=window.weaveforge;if(w&&w.platform!=="darwin"&&typeof w.menuModel==="function")document.documentElement.setAttribute("data-titlebar","")}catch(e){}`;
