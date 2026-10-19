param([ValidateSet('Install','Start','Status')][string]$Action='Status')
$ErrorActionPreference='Stop'
$taskName='Wedex-Codex-Assistant'
$taskRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskProgram=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$taskArguments='-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $PSScriptRoot 'Start-Background.ps1')+'"'
$taskIdentity=[System.Security.Principal.WindowsIdentity]::GetCurrent()
function Assert-OwnedTask($task) {
 if($task.Actions.Count -ne 1 -or $task.Actions[0].Execute -ne $taskProgram -or $task.Actions[0].Arguments -ne $taskArguments -or $task.Actions[0].WorkingDirectory -ne $taskRoot){throw '同名任务的启动入口不匹配，未覆盖或启动'}
 $taskUser=[string]$task.Principal.UserId
 $taskSid=if($taskUser.StartsWith('S-1-')){$taskUser}else{([System.Security.Principal.NTAccount]::new($taskUser)).Translate([System.Security.Principal.SecurityIdentifier]).Value}
 if($taskSid -ne $taskIdentity.User.Value -or [int]$task.Principal.LogonType -ne 3 -or [int]$task.Principal.RunLevel -ne 0){throw '同名任务不属于当前用户的普通交互登录，未修改'}
 if(@($task.Triggers | Where-Object {$_}).Count -ne 0 -or $task.Settings.ExecutionTimeLimit -ne 'PT3M' -or [int]$task.Settings.MultipleInstances -ne 2){throw '任务设置与按需独立启动不一致，未启动'}
}
$task=Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
if($Action -eq 'Install' -and -not $task) {
 if(-not(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'Start-Background.ps1') -PathType Leaf)){throw '后台启动脚本不存在'}
 $taskCommand=New-ScheduledTaskAction -Execute $taskProgram -Argument $taskArguments -WorkingDirectory $taskRoot
 $taskPrincipal=New-ScheduledTaskPrincipal -UserId $taskIdentity.Name -LogonType Interactive -RunLevel Limited
 $taskSettings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::FromMinutes(3)) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
 $taskDefinition=New-ScheduledTask -Action $taskCommand -Principal $taskPrincipal -Settings $taskSettings -Description 'Wedex 当前用户按需启动；只拉起独立后台监督进程，不启用登录自启'
 Register-ScheduledTask -TaskName $taskName -TaskPath '\' -InputObject $taskDefinition -ErrorAction Stop | Out-Null
 $task=Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction Stop
}
if($task){Assert-OwnedTask $task}
if($Action -eq 'Start') {
 if(-not $task){throw '独立后台任务未安装，请运行 Task.ps1 -Action Install'}
 Start-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction Stop
 $task=Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction Stop
}
$taskInfo=if($task){Get-ScheduledTaskInfo -TaskName $taskName -TaskPath '\'}else{$null}
[PSCustomObject]@{taskName=$taskName;registered=[bool]$task;state=if($task){$task.State.ToString()}else{'Missing'};lastResult=if($taskInfo){$taskInfo.LastTaskResult}else{$null};manualOnly=$true} | ConvertTo-Json -Compress
