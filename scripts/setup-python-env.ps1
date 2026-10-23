param(
  [string]$PythonPath = "py",
  [string]$PythonVersion = "3.11",
  [string]$AiRoot = "",
  [switch]$SkipInstall,
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
$venvDir = Join-Path $environmentRoot "venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$requirementsPath = Join-Path $apiDir "requirements.txt"
$lockedRequirementsPath = Join-Path $apiDir "requirements-lock.txt"
$installRequirementsPath = if (Test-Path $lockedRequirementsPath) {
  $lockedRequirementsPath
} else {
  $requirementsPath
}

if (-not (Test-Path $requirementsPath)) {
  Write-Host "[NG] requirements.txt was not found." -ForegroundColor Red
  Write-Host "Expected: $requirementsPath"
  exit 1
}

if (-not (Test-Path $environmentRoot)) {
  New-Item -ItemType Directory -Path $environmentRoot -Force | Out-Null
}

if ((Test-Path $venvDir) -and -not $Force) {
  Write-Host "[OK] Python venv already exists." -ForegroundColor Green
  Write-Host "Path: $venvDir"
} else {
  if ((Test-Path $venvDir) -and $Force) {
    Write-Host "Removing existing venv: $venvDir" -ForegroundColor Yellow
    Remove-Item -LiteralPath $venvDir -Recurse -Force
  }

  Write-Host "Creating Python venv..." -ForegroundColor Cyan
  Write-Host "Path: $venvDir"

  if ($PythonPath -eq "py") {
    & $PythonPath "-$PythonVersion" -m venv $venvDir
  } else {
    & $PythonPath -m venv $venvDir
  }

  if ($LASTEXITCODE -ne 0) {
    Write-Host "[NG] Failed to create Python venv." -ForegroundColor Red
    exit $LASTEXITCODE
  }
}

if (-not (Test-Path $venvPython)) {
  Write-Host "[NG] venv Python was not found." -ForegroundColor Red
  Write-Host "Expected: $venvPython"
  exit 1
}

if ($SkipInstall) {
  Write-Host "[OK] venv is ready. Dependency installation was skipped." -ForegroundColor Green
  Write-Host "Python: $venvPython"
  exit 0
}

Write-Host "Upgrading pip..." -ForegroundColor Cyan
& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) {
  Write-Host "[NG] Failed to upgrade pip." -ForegroundColor Red
  exit $LASTEXITCODE
}

Write-Host "Installing API requirements..." -ForegroundColor Cyan
Write-Host "This can take a long time because PyTorch, OpenMMLab, and CUDA-related packages are large."
& $venvPython -m pip install -r $installRequirementsPath
if ($LASTEXITCODE -ne 0) {
  Write-Host "[NG] Failed to install API requirements." -ForegroundColor Red
  exit $LASTEXITCODE
}

Write-Host "[OK] Python environment is ready." -ForegroundColor Green
Write-Host "Python: $venvPython"
Write-Host "Next: .\scripts\check-ai-environment.ps1 -UseVenv"
