param([ValidateSet('InstallAndOpen','Install','Start','OpenConsole','Status','Stop')][string]$Action='Status')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$OutputEncoding=[Console]::OutputEncoding
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskPowerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
try {
  if($Action -in @('InstallAndOpen','Install')) {
    & $taskPowerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $taskRoot 'Setup.ps1')
    if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
    if($Action -eq 'Install'){exit 0}
    $Action='OpenConsole'
  }
  & $taskPowerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Control.ps1') -Action $Action
  exit $LASTEXITCODE
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
