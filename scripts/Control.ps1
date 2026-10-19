param([ValidateSet('Start','Stop','Status','OpenConsole','PrepareConsole','InstallStartup','UninstallStartup')][string]$Action='Status')
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$OutputEncoding=[Console]::OutputEncoding
$root=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $PSScriptRoot 'Runtime.ps1')
try {
  $runtime=Get-WedexRuntime -Root $root
  Set-WedexProcessEnvironment -Root $root -Runtime $runtime
  if($Action -in @('InstallStartup','UninstallStartup')){
    $startup=Join-Path ([Environment]::GetFolderPath('Startup')) 'Wedex.lnk'
    $shell=New-Object -ComObject WScript.Shell
    if(Test-Path -LiteralPath $startup){
      $existing=$shell.CreateShortcut($startup)
      if($existing.TargetPath -ne (Join-Path $root 'Wedex.bat')){throw '启动文件夹中的 Wedex.lnk 指向其他部署，未覆盖或删除。'}
    }
    if($Action -eq 'InstallStartup'){
      $link=$shell.CreateShortcut($startup);$link.TargetPath=Join-Path $root 'Wedex.bat';$link.WorkingDirectory=$root;$link.Description='Wedex 私人助手';$link.Save()
      Write-Output '已为当前用户启用 Wedex 登录自启。'
    }elseif(Test-Path -LiteralPath $startup){Remove-Item -LiteralPath $startup;Write-Output '已移除当前用户的 Wedex 登录自启。'}
    exit 0
  }
  Set-Location -LiteralPath $root
  & $runtime.Node (Join-Path $PSScriptRoot 'control.mjs') $Action
  exit $LASTEXITCODE
} catch {Write-Error $_.Exception.Message -ErrorAction Continue;exit 1}
