<#
.SYNOPSIS
  Keep asking Oracle for an Always Free Ampere instance until one is free.

.DESCRIPTION
  Always Free A1 capacity in popular regions is contended, and `Out of host
  capacity` can persist for days. This retries on a schedule and stops the
  moment it succeeds.

  The reason it is not a one-line retry loop: such a loop cannot tell "no
  capacity right now" from "your subnet OCID has a typo", so a malformed
  request retries in silence until morning. This aborts immediately on
  anything that will never succeed, and only retries the one error genuinely
  worth waiting on.

  The PowerShell twin of oci-launch-retry.sh. Same behaviour; this one exists
  because Git Bash is not on PATH in a default PowerShell session, and the
  overnight run should not depend on which shell you happen to open.

.EXAMPLE
  ./scripts/oci-launch-retry.ps1

.EXAMPLE
  ./scripts/oci-launch-retry.ps1 -ShapeLadder '1:6' -IntervalSeconds 60
#>

[CmdletBinding()]
param(
  [string]   $DisplayName       = 'weaveforge',
  [string]   $Shape             = 'VM.Standard.A1.Flex',
  [int]      $BootVolumeGb      = 50,
  [string]   $SshKeyFile        = "$HOME\.ssh\oci_weaveforge.pub",
  [int]      $IntervalSeconds   = 90,
  [int]      $MaxHours          = 12,

  # Sizes to try, largest first, as "ocpus:memoryGb".
  #
  # Oracle has to place the whole shape on a single host, so a smaller request
  # fits gaps a larger one cannot. Asking for 2/12 all night while 1/6 slots go
  # free is a common way to wait far longer than necessary. Always Free is
  # 2 OCPUs / 12 GB total since 15 June 2026 — going above that bills you.
  [string[]] $ShapeLadder       = @('2:12', '1:6'),

  # Substring an image's display name must contain. The default picks the plain
  # Ubuntu 24.04 ARM image: 'Canonical-Ubuntu-24.04-Minimal-aarch64' does not
  # contain '24.04-aarch64', so Minimal is excluded. Use '24.04-Minimal-aarch64'
  # if you want it anyway.
  [string]   $ImagePattern      = '24.04-aarch64',

  [string]   $CompartmentId,
  [string]   $SubnetId,
  [string]   $ImageId,
  [string]   $AvailabilityDomain
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# The CLI's "permissions are too open" check shells out to read the file's ACL
# and, on some Windows setups, misparses what comes back — reporting a long list
# of nonsense principals for a file that is correctly locked down. Left alone it
# prints a paragraph of noise before every single call, into a log meant to be
# skimmed in the morning.
#
# Verify the real permissions once, then silence it:
#   icacls "$HOME\.oci\config"
# SYSTEM, Administrators and your own user should be the only entries.
$env:OCI_CLI_SUPPRESS_FILE_PERMISSIONS_WARNING = 'True'

function Note($m) { Write-Host "  $m" -ForegroundColor DarkGray }
function Die($m)  { Write-Host "`n[X] $m`n" -ForegroundColor Red; exit 1 }

if (-not (Get-Command oci -ErrorAction SilentlyContinue)) {
  Die @"
The OCI CLI is not installed. Install it with:

      uv tool install oci-cli

    then reopen PowerShell so PATH picks it up.
"@
}

# Check authentication before anything else. Every discovery step below fails
# when the CLI is unconfigured, but each fails describing the thing it was
# looking for — "could not find a compartment" sends you hunting for an OCID
# when the real answer is that no credentials exist yet.
$null = oci iam region list 2>&1
if ($LASTEXITCODE -ne 0) {
  if (Test-Path "$HOME\.oci\config") {
    Die @"
The OCI CLI is installed but its credentials are not working.
    Check ~/.oci/config and that the API key is uploaded under
    Profile -> My profile -> API keys. Test with: oci iam region list
"@
  }
  Die @"
The OCI CLI is installed but not configured yet.
    Console -> profile avatar -> My profile -> API keys -> Add API key,
    then save the configuration preview it shows you to ~/.oci/config.
    Test with: oci iam region list
"@
}

# --- Discover whatever was not passed in -----------------------------------

Write-Host "`nResolving" -ForegroundColor Blue

function OciValue([string[]]$ociArgs) {
  $out = & oci @ociArgs 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
  $value = ($out | Select-Object -Last 1).Trim()
  if ($value -in @('', 'null')) { return $null }
  return $value
}

if (-not $CompartmentId) {
  $CompartmentId = OciValue @('iam','compartment','list','--all',
    '--query',"data[?`"lifecycle-state`"=='ACTIVE'] | [0].id",'--raw-output')
  if (-not $CompartmentId) { Die 'Could not find a compartment. Pass -CompartmentId.' }
}
Note "compartment  $($CompartmentId.Substring(0,[Math]::Min(28,$CompartmentId.Length)))..."

if (-not $AvailabilityDomain) {
  $AvailabilityDomain = OciValue @('iam','availability-domain','list','--query','data[0].name','--raw-output')
  if (-not $AvailabilityDomain) { Die 'Could not list availability domains. Pass -AvailabilityDomain.' }
}
Note "domain       $AvailabilityDomain"

if (-not $SubnetId) {
  $SubnetId = OciValue @('network','subnet','list','--compartment-id',$CompartmentId,'--all',
    '--query','data[0].id','--raw-output')
  if (-not $SubnetId) { Die 'Could not find a subnet. Pass -SubnetId (Networking -> VCN -> Subnets).' }
}
Note "subnet       $($SubnetId.Substring(0,[Math]::Min(28,$SubnetId.Length)))..."

if (-not $ImageId) {
  # Two filters, both load-bearing:
  #
  # --shape, because the x86 images share a display name and will not boot on
  # Ampere; and the pattern, because matching only 'aarch64' also matches 22.04
  # and the Minimal variants. `--sort-by TIMECREATED` does not save you there —
  # a 22.04 image published later than a 24.04 one sorts first, so you silently
  # get the older release.
  #
  # '24.04-aarch64' matches the plain image only: the Minimal one is named
  # '24.04-Minimal-aarch64' and does not contain that substring. Plain is worth
  # preferring — Minimal omits nano and iptables-persistent, both of which the
  # guide needs.
  $ImageId = OciValue @('compute','image','list','--compartment-id',$CompartmentId,
    '--operating-system','Canonical Ubuntu','--shape',$Shape,
    '--query',"data[?contains(`"display-name`",'$ImagePattern')] | [0].id",'--raw-output')
  if (-not $ImageId) { Die "No Ubuntu image matching '$ImagePattern'. Pass -ImageId, or -ImagePattern to widen the match." }
}
$imageName = OciValue @('compute','image','get','--image-id',$ImageId,'--query','data."display-name"','--raw-output')
Note "image        $(if ($imageName) { $imageName } else { $ImageId })"

if (-not (Test-Path $SshKeyFile)) {
  Die "No public key at $SshKeyFile. Generate one (guide 0.4) or pass -SshKeyFile."
}
Note "ssh key      $SshKeyFile"

# --- Attempt ----------------------------------------------------------------

$log      = Join-Path $root 'oci-launch-retry.log'
$deadline = (Get-Date).AddHours($MaxHours)
$attempt  = 0

# Errors that will still be errors in an hour. Retrying these only hides them.
$fatal = 'NotAuthenticated|NotAuthorizedOrNotFound|LimitExceeded|QuotaExceeded|InvalidParameter|CannotParseRequest|InvalidImage|MissingParameter'

Write-Host "`nTrying" -ForegroundColor Blue -NoNewline
Write-Host " - ladder: $($ShapeLadder -join ', '), every ${IntervalSeconds}s, giving up after ${MaxHours}h"
Note "log: $log        stop with Ctrl-C"
Write-Host ''

# Did an instance appear despite the client giving up on the request?
#
# A launch can succeed on Oracle's side while the connection times out on ours
# — `RequestException: The connection to endpoint timed out` is exactly that
# shape of failure, and it says nothing about whether the VM was created. Retry
# blindly after one and you get a second instance, quietly over the free
# allowance. So look before every attempt, not just the first.
function Get-ExistingInstance {
  $q = "data[?`"display-name`"=='$DisplayName' && `"lifecycle-state`"!='TERMINATED' && `"lifecycle-state`"!='TERMINATING'] | [0].id"
  return OciValue @('compute','instance','list','--compartment-id',$CompartmentId,'--all','--query',$q,'--raw-output')
}

function Show-Landed([string]$id, [string]$why) {
  $ip = OciValue @('compute','instance','list-vnics','--instance-id',$id,'--query','data[0]."public-ip"','--raw-output')
  Write-Host "`n`n[OK] $why" -ForegroundColor Green
  if ($ip) {
    Write-Host "  Public IP: $ip"
    Write-Host "  ssh -i $($SshKeyFile -replace '\.pub$','') ubuntu@$ip"
  } else {
    Write-Host "  Instance: $id (no public IP yet — give it a minute)"
  }
  Note "`n  Next: guide 1.6, then 1.4 for the firewall inside the VM."
}

if ($existing = Get-ExistingInstance) {
  Show-Landed $existing "An instance named '$DisplayName' already exists — not creating another."
  exit 0
}

while ((Get-Date) -lt $deadline) {
  foreach ($pair in $ShapeLadder) {
    $ocpus, $mem = $pair -split ':'
    $attempt++

    Write-Host ("  [{0}] attempt {1} - {2} OCPU / {3} GB ... " -f (Get-Date -Format HH:mm:ss), $attempt, $ocpus, $mem) -NoNewline -ForegroundColor DarkGray

    $out = & oci compute instance launch `
      --compartment-id $CompartmentId `
      --availability-domain $AvailabilityDomain `
      --shape $Shape `
      --shape-config "{`"ocpus`":$ocpus,`"memoryInGBs`":$mem}" `
      --image-id $ImageId `
      --subnet-id $SubnetId `
      --display-name $DisplayName `
      --assign-public-ip true `
      --boot-volume-size-in-gbs $BootVolumeGb `
      --ssh-authorized-keys-file $SshKeyFile `
      --wait-for-state RUNNING 2>&1 | Out-String
    $ok = ($LASTEXITCODE -eq 0)

    "--- $(Get-Date -Format o) ${ocpus}/${mem}`n$out" | Add-Content $log

    if ($ok) {
      $id = ([regex]'ocid1\.instance\.[^"\s]+').Match($out).Value
      $s  = if ($attempt -eq 1) { '' } else { 's' }
      Show-Landed $id "Got one. $ocpus OCPU / $mem GB after $attempt attempt$s."
      exit 0
    }

    if ($out -match $fatal) {
      Write-Host ''
      Write-Host $out
      Die "That will not fix itself - stopping rather than retrying all night. Full output in $log."
    }

    if ($out -match 'out of (host )?capacity|OutOfHostCapacity') {
      Write-Host 'no capacity' -ForegroundColor DarkGray
    }
    elseif ($out -match 'RequestException|connection to endpoint timed out|ConnectTimeout|ReadTimeout|Max retries exceeded') {
      # Client-side: the request never got a verdict. It may still have landed,
      # so the next loop checks before asking again.
      Write-Host 'network timeout - verifying nothing was created' -ForegroundColor DarkGray
      if ($existing = Get-ExistingInstance) {
        Show-Landed $existing 'The request timed out, but the instance was created anyway.'
        exit 0
      }
    }
    else {
      Write-Host 'failed (see log)' -ForegroundColor DarkGray
    }
  }

  Start-Sleep -Seconds $IntervalSeconds
}

Die "Gave up after ${MaxHours}h and $attempt attempts. Capacity genuinely scarce - try another time of day, or see the Pay As You Go note in the guide."
