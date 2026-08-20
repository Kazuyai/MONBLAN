param(
  [string]$BaseUrl = "http://127.0.0.1:8000",
  [string]$SampleVideoPath = "",
  [switch]$SkipLocalEnvironmentCheck
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$checkScript = Join-Path $scriptDir "check-ai-environment.ps1"

function Write-Ok {
  param([string]$Message)
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Ng {
  param([string]$Message)
  Write-Host "[NG] $Message" -ForegroundColor Red
}

function Invoke-Json {
  param(
    [string]$Method,
    [string]$Uri,
    [object]$Body = $null
  )

  if ($null -eq $Body) {
    return Invoke-RestMethod -Method $Method -Uri $Uri -TimeoutSec 10
  }

  return Invoke-RestMethod `
    -Method $Method `
    -Uri $Uri `
    -ContentType "application/json" `
    -Body ($Body | ConvertTo-Json -Depth 10) `
    -TimeoutSec 30
}

Write-Host "AI pipeline lightweight verification" -ForegroundColor Cyan
Write-Host "BaseUrl: $BaseUrl"
Write-Host ""

if (-not $SkipLocalEnvironmentCheck) {
  if (-not (Test-Path $checkScript)) {
    Write-Ng "check-ai-environment.ps1 was not found."
    Write-Host "Expected: $checkScript"
    exit 1
  }

  Write-Host "Running local environment check..." -ForegroundColor Cyan
  & powershell -ExecutionPolicy Bypass -File $checkScript
  if ($LASTEXITCODE -ne 0) {
    Write-Ng "Local AI environment check failed."
    exit $LASTEXITCODE
  }
  Write-Host ""
}

try {
  $environment = Invoke-Json -Method "GET" -Uri "$BaseUrl/environment/"
  Write-Ok "GET /environment/ succeeded."
} catch {
  Write-Ng "GET /environment/ failed."
  Write-Host "Start the API first:"
  Write-Host "python -m uvicorn API.api:app --host 127.0.0.1 --port 8000"
  Write-Host $_.Exception.Message
  exit 1
}

if ($environment.ai_available) {
  Write-Ok "API reports ai_available=true."
} else {
  Write-Ng "API reports ai_available=false."
  if ($environment.missing) {
    Write-Host "Missing items:"
    foreach ($missing in $environment.missing) {
      Write-Host "  - $($missing.name)"
    }
  }
  exit 1
}

if ($SampleVideoPath) {
  $resolvedVideoPath = Resolve-Path -LiteralPath $SampleVideoPath -ErrorAction Stop
  Write-Host ""
  Write-Host "Checking sample video frame rate..." -ForegroundColor Cyan
  Write-Host "Video: $resolvedVideoPath"

  try {
    $frameRate = Invoke-Json `
      -Method "POST" `
      -Uri "$BaseUrl/get_framerate_from_path/" `
      -Body @{ file_path = $resolvedVideoPath.Path }
    Write-Ok "POST /get_framerate_from_path/ succeeded. frame_rate=$($frameRate.frame_rate)"
  } catch {
    Write-Ng "POST /get_framerate_from_path/ failed."
    Write-Host $_.Exception.Message
    exit 1
  }
} else {
  Write-Host ""
  Write-Host "Sample video check was skipped. Pass -SampleVideoPath to verify /get_framerate_from_path/." -ForegroundColor Yellow
}

Write-Host ""
Write-Ok "Lightweight verification completed."
