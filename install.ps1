#Requires -Version 5.1
<#
.SYNOPSIS
  Thin Windows bootstrap for @archonvii/archon-setup.

.DESCRIPTION
  Verifies the prerequisites archon-setup needs (Node.js >= 20 and the GitHub
  CLI), printing actionable guidance if anything is missing, then launches the
  published package with `npx @archonvii/archon-setup`. This is a thin slice:
  native installers (winget/scoop) are deferred — see docs/WINDOWS_INSTALL.md.

.PARAMETER DryRun
  Run the prerequisite checks and report what would happen, but do NOT launch
  the wizard. Useful for CI / prereq verification.

.EXAMPLE
  iwr -useb https://raw.githubusercontent.com/ArchonVII/archon-setup/main/install.ps1 | iex

.EXAMPLE
  ./install.ps1 -DryRun
#>
[CmdletBinding()]
param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

# archon-setup requires Node >= 20 (package.json "engines": { "node": ">=20" }).
$MinNodeMajor = 20

function Test-CommandExists($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

$problems = @()

if (-not (Test-CommandExists "node")) {
  $problems += "Node.js is not installed. Install Node >= $MinNodeMajor from https://nodejs.org/ (or: winget install OpenJS.NodeJS.LTS)."
}
else {
  # `node --version` prints e.g. "v20.11.0"; take the major component.
  $nodeVersion = (& node --version).TrimStart("v")
  $nodeMajor = [int]($nodeVersion.Split(".")[0])
  if ($nodeMajor -lt $MinNodeMajor) {
    $problems += "Node.js $nodeVersion is too old; archon-setup needs Node >= $MinNodeMajor. Upgrade from https://nodejs.org/."
  }
}

if (-not (Test-CommandExists "gh")) {
  $problems += "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/ (or: winget install GitHub.cli), then run: gh auth login."
}

if ($problems.Count -gt 0) {
  Write-Host "archon-setup prerequisites are not met:" -ForegroundColor Red
  foreach ($p in $problems) { Write-Host "  - $p" }
  exit 1
}

Write-Host "Prerequisites OK: Node >= $MinNodeMajor and gh are available." -ForegroundColor Green

if ($DryRun) {
  Write-Host "Dry run: would launch ``npx @archonvii/archon-setup``."
  exit 0
}

Write-Host "Launching archon-setup..."
& npx @archonvii/archon-setup
exit $LASTEXITCODE
