# Installer art

The Windows installer (NSIS, made by `npm run tauri -- build --bundles nsis`)
uses these files. `tauri.conf.json` names them under `bundle.windows.nsis`:

- `header.bmp` (300×114, drawn at 150×57) is the header on every page that has one.
- `sidebar.bmp` (328×628, drawn at 164×314) is the Welcome and Finish pages.
- `installer.nsh` holds the header strip colours and the hooks
  (`installerHooks`): before install and before uninstall, it closes a running
  WeaveForge (the Electron `WeaveForge.exe` or the Tauri `weaveforge-shell.exe`),
  so the sign-in port and the files are free.
- The installer and uninstaller icons are `icons/icon.ico`. They are static and do not follow the theme. The running app sets its own window and taskbar icon at runtime (see `docs/building/core/shell.md`).

The uninstaller and the in-app updater (which runs the same NSIS file) use the
same art. Look at `tauri.conf.json` for the exact keys.

NSIS takes 24-bit BMP only. It stretches each bitmap to its control, which is
150×57 and 164×314 at 100% display scale and grows with the scale, using
nearest-neighbour sampling. The BMPs are twice the control size (300×114 and
328×628), so at 150–200% they are scaled down and stay sharp; a 1× bitmap is
blown up and blurs. `header.html` and `sidebar.html` are the sources: render
each at its control size with a headless browser at device scale factor 2 (for
example Edge `--headless=new --force-device-scale-factor=2
--window-size=164,314 --screenshot=...`) and save the PNG as a 24-bit BMP. `sidebar.html` is the look of the setup
window's art panel, zoomed to fit, so change both together.

`rubik.woff2` is Rubik (Latin, variable weight), by Hubert and Fischer, under
the SIL Open Font License 1.1. The `.html` sources load it from this folder.

`apps/shell/scripts/installer-config.test.mjs` checks that every path above
exists, that the BMPs have the sizes NSIS needs, and that the hooks are there.
