# Assemble docs/plans/current/design_recommended.html from the app's own stylesheet.
#
# Why a script rather than a hand-written page: the whole value of the mock is
# that it is the REAL components. Hand-copying ~3000 lines of CSS into a file
# guarantees it drifts from the app within a release, and a mock that lies about
# the design is worse than no mock. This inlines the stylesheets at build time, so
# `npm run mock:design` regenerates it from whatever the app currently ships.
#
# The markup lives in `design_recommended.body.html` and is NOT generated — it is
# the part that has to be written, and it uses the app's own class names
# (`.entity-card`, `.screen-head`, `.settings-tabs`, `.bottom-nav`, …) so that
# if a class is renamed in the app, the mock visibly breaks instead of quietly
# looking fine.

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$appStyles = Join-Path $root "apps\web\src\app\styles"
$appThemes = Join-Path $root "apps\web\src\app\themes"
$outDir = Join-Path $root "docs\plans\current"

# Order matters: tokens first, then the alias layer, then base, then components —
# the same order `styles/index.css` uses, because cascade order is load-bearing in
# this app (the token split is positional).
$themes = @("light.css", "dark.css", "common.css")
$componentOrder = @(
    "base.css", "forms.css", "buttons.css", "nav.css", "shell.css",
    "entity-cards.css", "cards.css", "lists.css", "settings.css",
    "dashboard.css", "loading.css", "experiments.css", "papers.css",
    "graph.css", "surfaces.css", "overlays.css", "sections.css"
)

$sb = [System.Text.StringBuilder]::new()
foreach ($f in $themes) {
    $path = Join-Path $appThemes $f
    if (-not (Test-Path $path)) { throw "missing theme: $f" }
    [void]$sb.AppendLine("/* ==== themes/$f ==== */")
    [void]$sb.AppendLine([System.IO.File]::ReadAllText($path))
}
foreach ($f in $componentOrder) {
    $path = Join-Path $appStyles $f
    if (-not (Test-Path $path)) { throw "missing stylesheet: $f" }
    [void]$sb.AppendLine("/* ==== styles/$f ==== */")
    [void]$sb.AppendLine([System.IO.File]::ReadAllText($path))
}

$body = [System.IO.File]::ReadAllText((Join-Path $outDir "design_recommended.body.html"))
$css = $sb.ToString()
$html = $body.Replace("/*__APP_CSS__*/", $css)
$out = Join-Path $outDir "design_recommended.html"
[System.IO.File]::WriteAllText($out, $html)

$lines = ($css -split "`n").Count
Write-Host "mock:design wrote $out"
Write-Host "  inlined $($themes.Count) theme + $($componentOrder.Count) stylesheet files, $lines CSS lines"
