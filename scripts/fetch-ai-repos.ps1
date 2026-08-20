param(
  [string]$AlphaPoseUrl = "https://github.com/MVIG-SJTU/AlphaPose.git",
  [string]$MotionBertUrl = "https://github.com/Walter0807/MotionBERT.git",
  [switch]$SkipAlphaPose,
  [switch]$SkipMotionBert,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$apiDir = Join-Path $repoRoot "API"
$alphaPoseDir = Join-Path $apiDir "AlphaPose"
$motionBertDir = Join-Path $apiDir "MotionBERT"

function Assert-GitAvailable {
  $git = Get-Command git -ErrorAction SilentlyContinue
  if (-not $git) {
    Write-Host "[NG] git was not found in PATH." -ForegroundColor Red
    Write-Host "Install Git for Windows, then run this script again."
    exit 1
  }
}

function Clone-Repository {
  param(
    [string]$Name,
    [string]$Url,
    [string]$Destination
  )

  if ((Test-Path $Destination) -and -not $Force) {
    Write-Host "[OK] $Name already exists." -ForegroundColor Green
    Write-Host "Path: $Destination"
    return
  }

  if ((Test-Path $Destination) -and $Force) {
    Write-Host "Removing existing $Name directory: $Destination" -ForegroundColor Yellow
    Remove-Item -LiteralPath $Destination -Recurse -Force
  }

  Write-Host "Cloning $Name..." -ForegroundColor Cyan
  Write-Host "URL:  $Url"
  Write-Host "Path: $Destination"

  git clone $Url $Destination
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[NG] Failed to clone $Name." -ForegroundColor Red
    exit $LASTEXITCODE
  }

  Write-Host "[OK] $Name was cloned." -ForegroundColor Green
}

Assert-GitAvailable

if (-not (Test-Path $apiDir)) {
  Write-Host "[NG] API directory was not found." -ForegroundColor Red
  Write-Host "Expected: $apiDir"
  exit 1
}

if (-not $SkipAlphaPose) {
  Clone-Repository -Name "AlphaPose" -Url $AlphaPoseUrl -Destination $alphaPoseDir
}

if (-not $SkipMotionBert) {
  Clone-Repository -Name "MotionBERT" -Url $MotionBertUrl -Destination $motionBertDir
}

Write-Host ""
Write-Host "Repository fetch step is complete." -ForegroundColor Green
Write-Host "Next: place the required checkpoint files, then run:"
Write-Host ".\scripts\check-ai-environment.ps1"
