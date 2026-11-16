# Installer art

The Windows installer (NSIS, made by `npm run tauri -- build --bundles nsis`)
uses these files. `tauri.conf.json` names them under `bundle.windows.nsis`:

- `header.bmp` (150×57) is the header on every page that has one.
- `sidebar.bmp` (164×314) is the Welcome and Finish pages.
- `installer.nsh` holds the header strip colours and the hooks
  (`installerHooks`): before install and before uninstall, it closes a running
  WeaveForge (the Electron `WeaveForge.exe` or the Tauri `weaveforge-shell.exe`),
  so the sign-in port and the files are free.
- The installer and uninstaller icons are `icons/icon.ico`. They are static and do not follow the theme. The running app sets its own window and taskbar icon at runtime (see `docs/building/core/shell.md`).

The uninstaller and the in-app updater (which runs the same NSIS file) use the
same art. Look at `tauri.conf.json` for the exact keys.

NSIS takes 24-bit BMP only. `header.html` and `sidebar.html` are the sources:
render each at exactly its size with a headless browser (device scale factor 1)
and save the PNG as a 24-bit BMP. `sidebar.html` is the look of the setup
window's art panel, zoomed to fit, so change both together.

`rubik.woff2` is Rubik (Latin, variable weight), by Hubert and Fischer, under
the SIL Open Font License 1.1. The `.html` sources load it from this folder.

`apps/shell/scripts/installer-config.test.mjs` checks that every path above
exists, that the BMPs have the sizes NSIS needs, and that the hooks are there.
