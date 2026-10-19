# Explicit integration check. Creates and removes only its own random Scheduled Task.
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $root 'scripts/Runtime.ps1')
$runtime=Get-WedexRuntime -Root $root
$id=[Guid]::NewGuid().ToString('N')
$name='Wedex-Install-Probe-'+$id
$fixture=Join-Path $root ('test-output/installer/task probe '+$id)
New-Item -ItemType Directory -Force -Path $fixture | Out-Null
$childScript=Join-Path $fixture 'child with spaces.mjs'
$state=Join-Path $fixture 'child.json';$stop=Join-Path $fixture 'stop'
$starter=Join-Path $fixture 'start with spaces.ps1'
function Quote-PS([string]$Value){return "'"+$Value.Replace("'","''")+"'"}
$childSource="import fs from 'node:fs';fs.writeFileSync(process.argv[2],JSON.stringify({pid:process.pid}));const t=setInterval(()=>{if(fs.existsSync(process.argv[3])){clearInterval(t);process.exit(0)}},100);setTimeout(()=>process.exit(2),60000).unref();"
[IO.File]::WriteAllText($childScript,$childSource,[Text.UTF8Encoding]::new($false))
$arguments='"'+$childScript+'" "'+$state+'" "'+$stop+'"'
$starterSource='$ErrorActionPreference=''Stop'''+[Environment]::NewLine+'Start-Process -FilePath '+(Quote-PS $runtime.Node)+' -ArgumentList '+(Quote-PS $arguments)+' -WorkingDirectory '+(Quote-PS $fixture)+' -WindowStyle Hidden | Out-Null'
[IO.File]::WriteAllText($starter,$starterSource,[Text.UTF8Encoding]::new($true))
$shell=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$registered=$false;$childPid=$null
try {
  if(Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue){throw 'Probe task unexpectedly exists; not overwriting.'}
  $action=New-ScheduledTaskAction -Execute $shell -Argument ('-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+$starter+'"') -WorkingDirectory $fixture
  $principal=New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
  # A short limit makes survival after the completed starter observable quickly.
  $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::FromSeconds(5)) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $name -Action $action -Principal $principal -Settings $settings | Out-Null
  $registered=$true
  Start-ScheduledTask -TaskName $name
  $deadline=[DateTime]::UtcNow.AddSeconds(20)
  while(-not(Test-Path -LiteralPath $state) -and [DateTime]::UtcNow -lt $deadline){Start-Sleep -Milliseconds 100}
  if(-not(Test-Path -LiteralPath $state)){throw 'Fixture child did not start.'}
  $childPid=(Get-Content -LiteralPath $state -Raw | ConvertFrom-Json).pid
  Start-Sleep -Seconds 8
  $task=Get-ScheduledTask -TaskName $name
  $info=Get-ScheduledTaskInfo -TaskName $name
  $alive=[bool](Get-Process -Id $childPid -ErrorAction SilentlyContinue)
  if($task.State -ne 'Ready' -or $info.LastTaskResult -ne 0 -or -not $alive){throw 'Background child did not survive the completed task starter.'}
  [PSCustomObject]@{taskName=$name;state=$task.State.ToString();lastResult=$info.LastTaskResult;childAlive=$alive;elapsedPastTaskLimit=$true;pathContainsSpaces=$true} | ConvertTo-Json -Compress
} finally {
  [IO.File]::WriteAllText($stop,'stop')
  if($childPid){$childProcess=Get-Process -Id $childPid -ErrorAction SilentlyContinue;if($childProcess){$childProcess.WaitForExit(5000) | Out-Null}}
  if($registered){Unregister-ScheduledTask -TaskName $name -Confirm:$false}
  # Retain tiny local evidence files; no external or application task is touched.
}
