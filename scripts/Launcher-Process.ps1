function New-LauncherProcessInfo([string]$ControlPath,[string]$Action,[string]$WorkingDirectory) {
  $taskInfo=[System.Diagnostics.ProcessStartInfo]::new()
  $taskInfo.FileName=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $taskInfo.Arguments='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$ControlPath+'" -Action '+$Action
  $taskInfo.UseShellExecute=$false
  $taskInfo.CreateNoWindow=$true
  $taskInfo.RedirectStandardOutput=$true
  $taskInfo.RedirectStandardError=$true
  $taskInfo.StandardOutputEncoding=[System.Text.UTF8Encoding]::new($false)
  $taskInfo.StandardErrorEncoding=[System.Text.UTF8Encoding]::new($false)
  $taskInfo.WorkingDirectory=$WorkingDirectory
  return $taskInfo
}
