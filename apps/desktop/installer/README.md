# Installer art

The NSIS installer's pictures, in the app's look (the Mocha palette, Rubik).

- `sidebar.bmp` — 164×314, the Welcome and Finish pages, and the uninstaller's.
- `header.bmp` — 150×57, the top-right of every other page.

NSIS takes 24-bit BMP only. The `.html` files are the sources: render each at
exactly its size with a headless browser (device scale factor 1), then save the
PNG as a 24-bit BMP.

## The themed setup window

`setup/` is what people download: a small Rust program (tao + wry, so the
pages are WebView2 HTML in `setup/ui/index.html`) with the NSIS installer
carried inside it. It shows the app's own pages — location, progress, done —
and runs the NSIS installer silently behind them (`/S /currentuser /D=<dir>`).

The NSIS file is still published unchanged: `latest.yml` names it, and the
in-app updater downloads and runs it silently, so updates never see the window.
The uninstaller is still NSIS's, in the Mocha colours from `installer.nsh`.

```
npm run package --workspace @weaveforge/desktop   # makes release/WeaveForge Setup <v>.exe
npm run pack:setup --workspace @weaveforge/desktop # makes release/WeaveForge-<v>-Setup.exe
```

`pack-setup.mjs` builds the window with cargo and appends the NSIS file, a
JSON description and a trailer to it; `setup/src/main.rs` reads them back.
Needs a Rust toolchain and, on the machine running setup, the WebView2 runtime
(part of Windows 11, and of Windows 10 since 2021).

`setup/ui/rubik.woff2` is Rubik (Latin, variable weight), by Hubert and Fischer,
under the SIL Open Font License 1.1.
