# Shared portable runtime resolution; importing this file does not mutate the environment.
function Get-WedexManifest([string]$Root) {
  return (Get-Content -LiteralPath (Join-Path $Root 'scripts/runtime-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json)
}
function Assert-WedexFileIntegrity([string]$Path,[string]$Expected) {
  if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "缺少安装文件：$Path。请重新运行 Wedex.bat。"}
  if((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Expected){throw "安装文件完整性校验失败：$Path。请重新运行安装。"}
}
function Get-WedexRuntime([Parameter(Mandatory=$true)][string]$Root) {
  $Root=[System.IO.Path]::GetFullPath($Root)
  $manifest=Get-WedexManifest $Root
  $node=Join-Path $Root 'runtime/node/node.exe'
  $npm=Join-Path $Root 'runtime/node/node_modules/npm/bin/npm-cli.js'
  $codex=Join-Path $Root 'runtime/codex/bin/codex.exe'
  Assert-WedexFileIntegrity $node $manifest.node.executableSha256
  Assert-WedexFileIntegrity $codex $manifest.codex.executableSha256
  Assert-WedexFileIntegrity (Join-Path $Root 'runtime/codex/bin/codex-code-mode-host.exe') $manifest.codex.codeModeHostSha256
  foreach($relative in $manifest.codex.requiredFiles){
    if(-not(Test-Path -LiteralPath (Join-Path (Join-Path $Root 'runtime/codex') $relative) -PathType Leaf)){throw "Codex 辅助程序缺失：$relative。请重新运行安装。"}
  }
  if(-not(Test-Path -LiteralPath $npm -PathType Leaf)){throw '本地 npm 缺失，请重新运行安装。'}
  $package=Get-Content -LiteralPath (Join-Path $Root 'runtime/codex/codex-package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if($package.version -ne $manifest.codex.version -or $package.target -ne 'x86_64-pc-windows-msvc'){throw 'Codex 安装版本或平台不匹配。'}
  return [PSCustomObject]@{Node=$node;Npm=$npm;Codex=$codex;NodeVersion=$manifest.node.version;CodexVersion=$manifest.codex.version}
}
function Test-WedexInstallation([Parameter(Mandatory=$true)][string]$Root) {
  $ErrorActionPreference='Stop'
  try {
    $runtime=Get-WedexRuntime -Root $Root
    $record=Get-Content -LiteralPath (Join-Path $Root 'runtime/installation.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $lockText=[IO.File]::ReadAllText((Join-Path $Root 'package-lock.json'))
    if($record.schemaVersion -ne 1 -or -not $record.environmentReady -or $record.nodeVersion -ne $runtime.NodeVersion -or $record.codexVersion -ne $runtime.CodexVersion -or $record.packageLock -cne $lockText){return $false}
    # Node reads the lock directly: Windows PowerShell cannot parse its empty root key.
    $verifyDependencies="const fs=require('node:fs'),p=require('node:path'),root=process.argv[1];try{const lock=JSON.parse(fs.readFileSync(p.join(root,'package-lock.json'),'utf8'));const manifest=JSON.parse(fs.readFileSync(p.join(root,'package.json'),'utf8')),declared=manifest.dependencies||{},locked=lock.packages[''].dependencies||{};if(Object.keys(declared).length!==Object.keys(locked).length||Object.entries(declared).some(([name,version])=>locked[name]!==version))process.exit(1);for(const [name,spec] of Object.entries(lock.packages)){if(!name)continue;const item=JSON.parse(fs.readFileSync(p.join(root,name,'package.json'),'utf8'));if(item.version!==spec.version)process.exit(1)}process.exit(0)}catch{process.exit(1)}"
    & $runtime.Node -e $verifyDependencies $Root | Out-Null
    if($LASTEXITCODE -ne 0){return $false}
    return $true
  } catch { return $false }
}
function Set-WedexProcessEnvironment([Parameter(Mandatory=$true)][string]$Root,$Runtime) {
  # Process-local only. Never read another deployment's credentials or change global PATH.
  $env:WECHAT_CODEX_EXE=$Runtime.Codex
  $env:CODEX_HOME=Join-Path $Root 'codex-home'
  $env:PATH=(Split-Path $Runtime.Node -Parent)+';'+(Split-Path $Runtime.Codex -Parent)+';'+(Join-Path $Root 'runtime/codex/codex-path')+';'+$env:PATH
}
