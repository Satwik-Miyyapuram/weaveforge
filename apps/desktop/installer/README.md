# Installer art

The NSIS installer's pictures, in the app's look (the Mocha palette, Rubik).

- `sidebar.bmp` — 164×314, the Welcome and Finish pages, and the uninstaller's.
- `header.bmp` — 150×57, the top-right of every other page.

NSIS takes 24-bit BMP only. The `.html` files are the sources: render each at
exactly its size with a headless browser (device scale factor 1), then save the
PNG as a 24-bit BMP.
