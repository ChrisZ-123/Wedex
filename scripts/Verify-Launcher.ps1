$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Launcher-Process.ps1')
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskInfo=New-LauncherProcessInfo (Join-Path $PSScriptRoot 'Launcher-Action.ps1') 'Status' $taskRoot
[Console]::OutputEncoding=[Text.Encoding]::GetEncoding(936)
$taskFixture="[Console]::OutputEncoding=[Text.UTF8Encoding]::new(`$false); [Console]::Out.WriteLine('Wedex 中文与 emoji 😊'); [Console]::Error.WriteLine('中文错误：测试')"
$taskInfo.Arguments='-NoLogo -NoProfile -NonInteractive -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($taskFixture))
$taskProcess=[Diagnostics.Process]::Start($taskInfo)
$taskOutput=$taskProcess.StandardOutput.ReadToEndAsync()
$taskError=$taskProcess.StandardError.ReadToEndAsync()
$taskProcess.WaitForExit()
try {
  if($taskProcess.ExitCode -ne 0 -or $taskOutput.Result.Trim() -ne 'Wedex 中文与 emoji 😊' -or $taskError.Result.Trim() -ne '中文错误：测试'){throw 'Launcher UTF-8 pipe verification failed'}
} finally {$taskProcess.Dispose()}
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
& (Join-Path $PSScriptRoot 'Launcher.ps1') -ValidateOnly
Write-Output 'Launcher UTF-8 stdout/stderr verified under code page 936; no install or service was started.'
