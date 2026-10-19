param([switch]$CheckOnly,[switch]$EnvironmentOnly)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$OutputEncoding=[Console]::OutputEncoding
$root=[System.IO.Path]::GetFullPath($PSScriptRoot)
. (Join-Path $root 'scripts/Runtime.ps1')
if($CheckOnly){
  $ready=Test-WedexInstallation -Root $root
  [PSCustomObject]@{ready=$ready;root=$root} | ConvertTo-Json -Compress
  if($ready){exit 0}else{exit 1}
}
$mutex=$null;$locked=$false;$stage=$null
function Step([string]$Message){[Console]::WriteLine('[Wedex] '+$Message)}
function Remove-OwnedRuntimeDirectory([string]$Path){
  $absolute=[System.IO.Path]::GetFullPath($Path)
  $boundary=(Join-Path $root 'runtime').TrimEnd('\')+'\'
  if(-not $absolute.StartsWith($boundary,[StringComparison]::OrdinalIgnoreCase)){throw '拒绝清理 runtime 以外的路径。'}
  if(Test-Path -LiteralPath $absolute){
    if((Get-Item -LiteralPath $absolute -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'runtime 目标是链接，未清理。'}
    Remove-Item -LiteralPath $absolute -Recurse -Force
  }
}
function Get-VerifiedArchive($Spec,[string]$Name){
  $archive=Join-Path $root ('runtime/downloads/'+$Name)
  if(Test-Path -LiteralPath $archive){
    if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -eq $Spec.sha256){Step "复用已校验下载：$Name";return $archive}
    Remove-Item -LiteralPath $archive -Force
  }
  Step "从官方源下载 $Name（首次可能需要几分钟）"
  $temporary=$archive+'.partial'
  if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force}
  $ProgressPreference='SilentlyContinue'
  Invoke-WebRequest -Uri $Spec.url -OutFile $temporary -UseBasicParsing -TimeoutSec 900
  Assert-WedexFileIntegrity $temporary $Spec.sha256
  Move-Item -LiteralPath $temporary -Destination $archive
  Step "$Name 官方 SHA256 校验通过"
  return $archive
}
function Expand-SafeZip([string]$Archive,[string]$Destination){
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip=[IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    $prefix=[IO.Path]::GetFullPath($Destination).TrimEnd('\')+'\'
    foreach($entry in $zip.Entries){
      $target=[IO.Path]::GetFullPath((Join-Path $Destination $entry.FullName))
      if(-not $target.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase) -or $entry.FullName.Contains(':') -or (($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000){throw 'ZIP 包含不安全路径或链接。'}
    }
  } finally {$zip.Dispose()}
  [IO.Compression.ZipFile]::ExtractToDirectory($Archive,$Destination)
}
function Expand-SafeTar([string]$Archive,[string]$Destination){
  $tar=Join-Path $env:SystemRoot 'System32/tar.exe'
  if(-not(Test-Path -LiteralPath $tar -PathType Leaf)){throw '需要 Windows 10/11 自带的 tar.exe。请更新 Windows 后重试。'}
  $entries=@(& $tar -tzf $Archive)
  if($LASTEXITCODE -ne 0){throw '无法读取已校验的 Codex 归档。'}
  foreach($entry in $entries){
    if($entry -match '(^[\\/]|:|(^|[\\/])\.\.([\\/]|$))'){throw 'Codex 归档包含不安全路径。'}
  }
  $details=@(& $tar -tvzf $Archive)
  if($LASTEXITCODE -ne 0 -or @($details | Where-Object {$_ -match '^[lh]'}).Count){throw 'Codex 归档包含链接或无法读取。'}
  & $tar -xzf $Archive -C $Destination
  if($LASTEXITCODE -ne 0){throw 'Codex 归档解压失败。'}
}
try {
  if(-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64'){throw '此版本仅支持 Windows x64。'}
  $mutex=[Threading.Mutex]::new($false,'Local\Wedex.Setup')
  try {$locked=$mutex.WaitOne(0)} catch [Threading.AbandonedMutexException] {$locked=$true}
  if(-not $locked){throw '另一个 Wedex 安装正在进行，请等待完成后重试。'}
  $manifest=Get-WedexManifest $root
  $ready=Test-WedexInstallation -Root $root
  New-Item -ItemType Directory -Force -Path (Join-Path $root 'runtime/downloads') | Out-Null
  if(-not $ready){
    $stage=Join-Path $root ('runtime/.setup-'+[Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage | Out-Null
    $runtimeValid=$false
    try {$null=Get-WedexRuntime -Root $root;$runtimeValid=$true} catch {}
    if(-not $runtimeValid){
      $nodeArchive=Get-VerifiedArchive $manifest.node 'node-v24.22.0-win-x64.zip'
      $codexArchive=Get-VerifiedArchive $manifest.codex 'codex.tar.gz'
      Step '解压便携 Node.js 与完整 Codex 程序包'
      $nodeStage=Join-Path $stage 'node';$codexStage=Join-Path $stage 'codex'
      New-Item -ItemType Directory -Path $codexStage | Out-Null
      Expand-SafeZip $nodeArchive $nodeStage
      Expand-SafeTar $codexArchive $codexStage
      Assert-WedexFileIntegrity (Join-Path $nodeStage ($manifest.node.archiveRoot+'/node.exe')) $manifest.node.executableSha256
      Assert-WedexFileIntegrity (Join-Path $codexStage 'bin/codex.exe') $manifest.codex.executableSha256
      Assert-WedexFileIntegrity (Join-Path $codexStage 'bin/codex-code-mode-host.exe') $manifest.codex.codeModeHostSha256
      Remove-OwnedRuntimeDirectory (Join-Path $root 'runtime/node')
      Remove-OwnedRuntimeDirectory (Join-Path $root 'runtime/codex')
      Move-Item -LiteralPath (Join-Path $nodeStage $manifest.node.archiveRoot) -Destination (Join-Path $root 'runtime/node')
      Move-Item -LiteralPath $codexStage -Destination (Join-Path $root 'runtime/codex')
    }
    $runtime=Get-WedexRuntime -Root $root
    Set-WedexProcessEnvironment -Root $root -Runtime $runtime
    Step '验证固定版本（不登录、不导入已有账号）'
    $nodeVersion=(& $runtime.Node --version | Out-String).Trim()
    if($LASTEXITCODE -ne 0 -or $nodeVersion -ne ('v'+$manifest.node.version)){throw 'Node.js 版本验证失败。'}
    # Version checks must also use a deployment-owned, empty Codex home.
    $versionHome=Join-Path $stage 'codex-version-home';New-Item -ItemType Directory -Path $versionHome | Out-Null
    $env:CODEX_HOME=$versionHome
    $codexVersion=(& $runtime.Codex --version | Out-String).Trim()
    if($LASTEXITCODE -ne 0 -or $codexVersion -ne ('codex-cli '+$manifest.codex.version)){throw 'Codex 版本验证失败。'}
    Step "$nodeVersion / $codexVersion"
    Step '安装锁定的应用依赖（官方 npm registry，不执行安装脚本）'
    foreach($name in @('npm-userconfig','npm-globalconfig')){[IO.File]::WriteAllText((Join-Path $root ('runtime/'+$name)),'',[Text.UTF8Encoding]::new($false))}
    Push-Location -LiteralPath $root
    try {
      & $runtime.Node $runtime.Npm ci --ignore-scripts --no-audit --no-fund --fetch-retries=0 --registry=https://registry.npmjs.org --cache (Join-Path $root 'runtime/npm-cache') --userconfig (Join-Path $root 'runtime/npm-userconfig') --globalconfig (Join-Path $root 'runtime/npm-globalconfig')
      if($LASTEXITCODE -ne 0){throw 'npm ci 失败；修复网络后请重新运行 Wedex.bat。'}
      & $runtime.Node --input-type=module -e "import('qrcode').then(()=>console.log('dependency import OK'))"
      if($LASTEXITCODE -ne 0){throw '应用依赖导入验证失败。'}
    } finally {Pop-Location}
    $record=[ordered]@{schemaVersion=1;environmentReady=$true;nodeVersion=$manifest.node.version;codexVersion=$manifest.codex.version;packageLock=[IO.File]::ReadAllText((Join-Path $root 'package-lock.json'));installedAt=[DateTime]::UtcNow.ToString('o')}
    [IO.File]::WriteAllText((Join-Path $root 'runtime/installation.json'),($record | ConvertTo-Json),[Text.UTF8Encoding]::new($false))
    if(-not(Test-WedexInstallation -Root $root)){throw '最终安装状态检查失败。'}
  } else {Step '本地运行环境与锁定依赖已就绪，跳过下载和依赖安装'}
  if(-not $EnvironmentOnly){
    Step '配置当前用户按需后台任务'
    $shell=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
    & $shell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $root 'scripts/Task.ps1') -Action Install
    if($LASTEXITCODE -ne 0){throw 'Wedex 后台任务配置失败。请检查同名任务后重试。'}
    Step '创建部署目录内的 Wedex 快捷方式'
    $linkPath=Join-Path $root 'Wedex.lnk'
    $wsh=New-Object -ComObject WScript.Shell
    if(Test-Path -LiteralPath $linkPath){
      $existing=$wsh.CreateShortcut($linkPath)
      if($existing.TargetPath -ne (Join-Path $root 'Wedex.bat')){throw '现有 Wedex.lnk 指向其他目标，未覆盖。'}
    }
    $shortcut=$wsh.CreateShortcut($linkPath);$shortcut.TargetPath=Join-Path $root 'Wedex.bat';$shortcut.WorkingDirectory=$root;$shortcut.Description='Wedex 私人助手'
    if(Test-Path -LiteralPath (Join-Path $root 'public/launcher.ico')){$shortcut.IconLocation=Join-Path $root 'public/launcher.ico'}
    $shortcut.Save()
  }
  Step '安装完成。'
} catch {Write-Output ('[Wedex] 安装失败：'+$_.Exception.Message);Write-Output '[Wedex] 未自动重试。处理上述问题后，重新运行 Wedex.bat。';exit 1}
finally {
  if($stage -and (Test-Path -LiteralPath $stage)){Remove-OwnedRuntimeDirectory $stage}
  if($locked){$mutex.ReleaseMutex()}
  if($mutex){$mutex.Dispose()}
}
