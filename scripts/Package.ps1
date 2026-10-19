param([Parameter(Mandatory=$true)][string]$Destination,[string]$Ref='HEAD')
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskDestination=[IO.Path]::GetFullPath($Destination)
if([IO.Path]::GetExtension($taskDestination) -ne '.zip'){throw 'Destination must be a ZIP file'}
if(Test-Path -LiteralPath $taskDestination){throw 'Archive exists; no overwrite performed'}
$taskResolved=@(& git -C $taskRoot rev-parse --verify ($Ref+'^{commit}'))
if($LASTEXITCODE -ne 0 -or $taskResolved.Count -ne 1){throw 'Release ref does not resolve to one commit'}
$taskCommit=$taskResolved[0].Trim()
& git -C $taskRoot archive --format=zip --prefix=Wedex/ --output=$taskDestination $taskCommit
if($LASTEXITCODE -ne 0){throw 'Git archive failed'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskArchive=[IO.Compression.ZipFile]::OpenRead($taskDestination)
try {
  $taskUnsafe=@($taskArchive.Entries|Where-Object{$_.FullName -match '^Wedex/(node_modules|runtime|state|codex-home|logs|test-output|\.cache)/|(^|/)(auth\.json|credentials\.dpapi)$|\.lnk$|(^|/)\.env($|\.)'})
  if($taskUnsafe.Count){throw 'Runtime/private data found in release archive'}
  foreach($taskRequired in @('Wedex.bat','Setup.ps1','scripts/Launcher.ps1','scripts/runtime-manifest.json','LICENSE','README.md','package-lock.json')) {
    if(-not $taskArchive.GetEntry('Wedex/'+$taskRequired)){throw ('Release file absent: '+$taskRequired)}
  }
  [PSCustomObject]@{commit=$taskCommit;archive=$taskDestination;entries=$taskArchive.Entries.Count;bytes=(Get-Item -LiteralPath $taskDestination).Length}|ConvertTo-Json -Compress
} finally {$taskArchive.Dispose()}
