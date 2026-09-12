<#
.SYNOPSIS
  Build the WeaveForge inking shell APK.

.DESCRIPTION
  Copies the project to a folder outside any cloud-synced tree and builds it
  there. Google Drive File Stream (and OneDrive) drop a `desktop.ini` into
  every folder they sync, and the Android Gradle Plugin's resource merger
  refuses a file it does not understand — so a checkout under Documents
  cannot be built in place.

  Needs JDK 17–24 (Gradle 8.14 does not run on 25) and the Android SDK.

.PARAMETER Url
  What the app loads; default https://app.weaveforge.org/. A LAN address
  (http://192.168.1.10:3000) is allowed for a debug build.

.PARAMETER Release
  Build the release variant (unsigned unless a signingConfig is added).
#>
param(
    [string]$Url = "",
    [switch]$Release
)

$ErrorActionPreference = "Stop"
$src = $PSScriptRoot
$dst = Join-Path $env:LOCALAPPDATA "weaveforge-android-build"

if (-not $env:JAVA_HOME) {
    $jdk = Get-ChildItem "$env:USERPROFILE\.jdks" -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match "jdk-(17|21)" } | Select-Object -First 1
    if ($jdk) { $env:JAVA_HOME = $jdk.FullName }
}
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA "Android\Sdk" }
if ($Url) { $env:WEAVEFORGE_URL = $Url }

robocopy $src $dst /MIR /XF desktop.ini /XD build .gradle .kotlin /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }

$task = if ($Release) { "assembleRelease" } else { "assembleDebug" }
Push-Location $dst
try {
    & .\gradlew.bat $task --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "gradle failed ($LASTEXITCODE)" }
} finally {
    Pop-Location
}

$variant = if ($Release) { "release" } else { "debug" }
$apk = Get-ChildItem (Join-Path $dst "app\build\outputs\apk\$variant") -Filter *.apk | Select-Object -First 1
$out = Join-Path $src "weaveforge-ink-$variant.apk"
Copy-Item $apk.FullName $out -Force
Write-Host "APK: $out"
