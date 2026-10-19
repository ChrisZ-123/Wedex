$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$root=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $PSScriptRoot 'Runtime.ps1')
try {
  $runtime=Get-WedexRuntime -Root $root
  Set-WedexProcessEnvironment -Root $root -Runtime $runtime
  $logs=Join-Path $root 'logs';New-Item -ItemType Directory -Force -Path $logs | Out-Null
  $supervisor=Join-Path $PSScriptRoot 'supervisor.mjs'
  Start-Process -FilePath $runtime.Node -ArgumentList ('"'+$supervisor+'"') -WorkingDirectory $root -WindowStyle Hidden | Out-Null
} catch {
  $message='['+[DateTime]::UtcNow.ToString('o')+'] Wedex 后台启动失败：'+$_.Exception.Message
  if(Test-Path -LiteralPath (Join-Path $root 'logs')){Add-Content -LiteralPath (Join-Path $root 'logs/startup.log') -Value $message -Encoding UTF8}
  Write-Error $message -ErrorAction Continue
  exit 1
}
