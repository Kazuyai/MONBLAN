param(
  [string]$PythonPath = "",
  [switch]$UseVenv,
  [switch]$Json
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$venvPython = Join-Path $repoRoot "API\venv\Scripts\python.exe"

if (-not $PythonPath) {
  if ($env:ANNOTATION_TOOL_PYTHON) {
    $PythonPath = $env:ANNOTATION_TOOL_PYTHON
  } elseif ($UseVenv -and (Test-Path $venvPython)) {
    $PythonPath = $venvPython
  } else {
    $PythonPath = "python"
  }
}

$pythonCode = @"
from API.environment import check_environment
import json

print(json.dumps(check_environment(), ensure_ascii=False))
"@

Push-Location $repoRoot
try {
  $output = & $PythonPath -c $pythonCode
  if ($LASTEXITCODE -ne 0) {
    throw "Python exited with code $LASTEXITCODE"
  }
} catch {
  Write-Host "[NG] AI environment check could not run." -ForegroundColor Red
  Write-Host "Python: $PythonPath"
  Write-Host $_.Exception.Message
  exit 1
} finally {
  Pop-Location
}

if ($Json) {
  $output
  exit 0
}

$result = $output | ConvertFrom-Json

Write-Host "AI environment check" -ForegroundColor Cyan
Write-Host "Python: $PythonPath"
Write-Host ""

foreach ($check in $result.checks) {
  if ($check.ok) {
    Write-Host "[OK] $($check.name)" -ForegroundColor Green
  } else {
    Write-Host "[NG] $($check.name)" -ForegroundColor Red
  }

  if ($check.path) {
    Write-Host "     $($check.path)"
  }
  if ($check.error) {
    Write-Host "     $($check.error)"
  }
  if ($check.name -eq "CUDA / PyTorch") {
    Write-Host "     torch=$($check.torch_version), cuda=$($check.cuda_version), devices=$($check.device_count)"
  }
}

Write-Host ""

if ($result.ai_available) {
  Write-Host "[OK] AI auto-annotation is available." -ForegroundColor Green
  exit 0
}

Write-Host "[NG] AI auto-annotation is not available." -ForegroundColor Red
Write-Host "Missing items:"
foreach ($missing in $result.missing) {
  Write-Host "  - $($missing.name)"
  if ($missing.path) {
    Write-Host "    $($missing.path)"
  }
  if ($missing.error) {
    Write-Host "    $($missing.error)"
  }
}

exit 1
