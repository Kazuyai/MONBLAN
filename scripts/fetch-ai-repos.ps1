param(
  [string]$AlphaPoseUrl = "https://github.com/MVIG-SJTU/AlphaPose.git",
  [string]$MotionBertUrl = "https://github.com/Walter0807/MotionBERT.git",
  [string]$AiRoot = "",
  [switch]$SkipAlphaPose,
  [switch]$SkipMotionBert,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$apiDir = Join-Path $repoRoot "API"
$environmentRoot = if ($AiRoot) {
  [System.IO.Path]::GetFullPath($AiRoot)
} else {
  $apiDir
}
$alphaPoseDir = Join-Path $environmentRoot "AlphaPose"
$motionBertDir = Join-Path $environmentRoot "MotionBERT"

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
    [string]$Destination,
    [string]$ExpectedFile
  )

  $resolvedEnvironmentRoot = [System.IO.Path]::GetFullPath($environmentRoot).TrimEnd('\')
  $resolvedDestination = [System.IO.Path]::GetFullPath($Destination)
  $destinationParent = [System.IO.Path]::GetDirectoryName($resolvedDestination).TrimEnd('\')
  if ($destinationParent -ne $resolvedEnvironmentRoot) {
    Write-Host "[NG] Refusing to modify a directory outside the AI environment root." -ForegroundColor Red
    Write-Host "AI root: $resolvedEnvironmentRoot"
    Write-Host "Target:  $resolvedDestination"
    exit 1
  }

  if ((Test-Path $Destination) -and -not $Force) {
    $expectedPath = Join-Path $Destination $ExpectedFile
    if (Test-Path $expectedPath) {
      Write-Host "[OK] $Name already exists." -ForegroundColor Green
      Write-Host "Path: $Destination"
      return
    }
    Write-Host "[NG] $Name directory exists but is incomplete." -ForegroundColor Red
    Write-Host "Path: $Destination"
    Write-Host "Expected: $expectedPath"
    exit 1
  }

  if ((Test-Path $Destination) -and $Force) {
    Write-Host "Removing existing $Name directory: $Destination" -ForegroundColor Yellow
    Remove-Item -LiteralPath $Destination -Recurse -Force
  }

  $temporaryDestination = "$Destination.download-$([guid]::NewGuid().ToString('N'))"
  Write-Host "Cloning $Name..." -ForegroundColor Cyan
  Write-Host "URL:  $Url"
  Write-Host "Path: $Destination"

  try {
    git clone --depth 1 $Url $temporaryDestination
    if ($LASTEXITCODE -ne 0) {
      Write-Host "[NG] Failed to clone $Name." -ForegroundColor Red
      exit $LASTEXITCODE
    }

    $temporaryExpectedPath = Join-Path $temporaryDestination $ExpectedFile
    if (-not (Test-Path $temporaryExpectedPath)) {
      Write-Host "[NG] The downloaded $Name repository is incomplete." -ForegroundColor Red
      Write-Host "Expected: $temporaryExpectedPath"
      exit 1
    }

    Move-Item -LiteralPath $temporaryDestination -Destination $Destination
  } finally {
    if (Test-Path $temporaryDestination) {
      Remove-Item -LiteralPath $temporaryDestination -Recurse -Force
    }
  }

  Write-Host "[OK] $Name was cloned." -ForegroundColor Green
}

Assert-GitAvailable

if (-not (Test-Path $environmentRoot)) {
  New-Item -ItemType Directory -Path $environmentRoot -Force | Out-Null
}

if (-not $SkipAlphaPose) {
  Clone-Repository -Name "AlphaPose" -Url $AlphaPoseUrl -Destination $alphaPoseDir -ExpectedFile "scripts\demo_inference.py"
}

if (-not $SkipMotionBert) {
  Clone-Repository -Name "MotionBERT" -Url $MotionBertUrl -Destination $motionBertDir -ExpectedFile "infer_wild.py"
}

Write-Host ""
Write-Host "Repository fetch step is complete." -ForegroundColor Green
Write-Host "Next: place the required checkpoint files, then run:"
Write-Host ".\scripts\check-ai-environment.ps1"
