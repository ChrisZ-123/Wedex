import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'scripts/runtime-manifest.json'),'utf8'));
test('runtime manifest pins official full Windows Codex package and Node archives',()=>{
  assert.equal(manifest.node.version,'24.22.0');
  assert.equal(manifest.codex.version,'0.163.0');
  assert.equal(new URL(manifest.node.url).hostname,'nodejs.org');
  assert.equal(new URL(manifest.codex.url).pathname,'/openai/codex/releases/download/rust-v0.163.0/codex-package-x86_64-pc-windows-msvc.tar.gz');
  for(const item of [manifest.node,manifest.codex])assert.match(item.sha256,/^[a-f0-9]{64}$/);
  assert.ok(manifest.codex.requiredFiles.includes('bin/codex-code-mode-host.exe'));
  assert.ok(manifest.codex.requiredFiles.includes('codex-resources/codex-command-runner.exe'));
});
test('CheckOnly is read only and reports incomplete installation under a path with spaces',{skip:process.platform!=='win32'},()=>{
  const parent=path.join(root,'test-output','installer');fs.mkdirSync(parent,{recursive:true});
  const fixture=fs.mkdtempSync(path.join(parent,'empty deployment '));fs.mkdirSync(path.join(fixture,'scripts'));
  for(const file of ['Setup.ps1','package.json','package-lock.json','scripts/Runtime.ps1','scripts/runtime-manifest.json'])fs.copyFileSync(path.join(root,file),path.join(fixture,file));
  const before=fs.readdirSync(fixture,{recursive:true}).sort();
  const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(fixture,'Setup.ps1'),'-CheckOnly'],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(result.status,1,result.stderr);
  assert.equal(JSON.parse(result.stdout.trim()).ready,false);
  assert.deepEqual(fs.readdirSync(fixture,{recursive:true}).sort(),before);
  fs.rmSync(fixture,{recursive:true});
});
test('setup rejects a concurrent installer before creating runtime files',{skip:process.platform!=='win32'},()=>{
  const parent=path.join(root,'test-output','installer');fs.mkdirSync(parent,{recursive:true});
  const fixture=fs.mkdtempSync(path.join(parent,'locked deployment '));fs.mkdirSync(path.join(fixture,'scripts'));
  for(const file of ['Setup.ps1','scripts/Runtime.ps1','scripts/runtime-manifest.json'])fs.copyFileSync(path.join(root,file),path.join(fixture,file));
  const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const quoted=value=>"'"+value.replaceAll("'","''")+"'";
  const command="$ErrorActionPreference='Stop';$m=[Threading.Mutex]::new($false,'Local\\Wedex.Setup');$owned=$m.WaitOne(0);if(-not $owned){throw 'Another installer is already active'};try{& "+quoted(shell)+' -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File '+quoted(path.join(fixture,'Setup.ps1'))+" -EnvironmentOnly;if($LASTEXITCODE -ne 1){throw 'Concurrent setup was not rejected'}}finally{$m.ReleaseMutex();$m.Dispose()}";
  const result=spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:15000});
  assert.equal(result.status,0,result.stderr);
  assert.equal(fs.existsSync(path.join(fixture,'runtime')),false);
  fs.rmSync(fixture,{recursive:true});
});

function failureFixture(prefix){
  const parent=path.join(root,'test-output','installer');fs.mkdirSync(parent,{recursive:true});
  const fixture=fs.mkdtempSync(path.join(parent,prefix+' '));fs.mkdirSync(path.join(fixture,'scripts'));
  for(const file of ['Setup.ps1','scripts/Runtime.ps1','scripts/runtime-manifest.json'])fs.copyFileSync(path.join(root,file),path.join(fixture,file));
  return fixture;
}
const quotePS=value=>"'"+value.replaceAll("'","''")+"'";
function runFailureHarness(fixture,source){
  const harness=path.join(fixture,'harness.ps1');fs.writeFileSync(harness,'\uFEFF'+"[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)\n"+source);
  const shell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const env={...process.env,PSModulePath:path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules')};
  return spawnSync(shell,['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',harness],{env,encoding:'utf8',windowsHide:true,timeout:15000});
}
test('corrupted official download is rejected before extraction',{skip:process.platform!=='win32'},()=>{
  const fixture=failureFixture('corrupted download');
  try{
    const source=`$ErrorActionPreference='Stop'
$root=${quotePS(fixture)}
New-Item -ItemType Directory -Path (Join-Path $root 'runtime/downloads') -Force | Out-Null
. (Join-Path $root 'scripts/Runtime.ps1')
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $root 'Setup.ps1'),[ref]$tokens,[ref]$errors)
if($errors){throw 'Invalid trusted Setup source'}
$names=@('Step','Get-VerifiedArchive')
foreach($definition in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $names -contains $node.Name},$true)){
  . ([scriptblock]::Create($definition.Extent.Text))
}
$global:FixtureCalls=0;$global:FixtureExtracted=$false
function Invoke-WebRequest {param($Uri,$OutFile,[switch]$UseBasicParsing,$TimeoutSec) $global:FixtureCalls++;[IO.File]::WriteAllText($OutFile,'fixture corrupted archive')}
function Expand-SafeZip {param($Archive,$Destination) $global:FixtureExtracted=$true;throw 'Unverified extraction reached'}
$spec=(Get-Content (Join-Path $root 'scripts/runtime-manifest.json') -Raw | ConvertFrom-Json).node
$rejected=$false;$failureMessage=''
try {$archive=Get-VerifiedArchive $spec 'node.zip';Expand-SafeZip $archive (Join-Path $root 'expanded')}catch{$failureMessage=$_.Exception.Message;$rejected=$failureMessage.Contains('完整性校验失败')}
if(-not $rejected -or $global:FixtureExtracted -or $global:FixtureCalls -ne 1){throw ('Corrupted archive boundary failed: '+$failureMessage)}
[PSCustomObject]@{rejected=$rejected;downloadCalls=$global:FixtureCalls;extracted=$global:FixtureExtracted;trustedArchiveExists=(Test-Path (Join-Path $root 'runtime/downloads/node.zip'))} | ConvertTo-Json -Compress
`;
    const result=runFailureHarness(fixture,source);assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
    const evidence=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.deepEqual(evidence,{rejected:true,downloadCalls:1,extracted:false,trustedArchiveExists:false});
  }finally{fs.rmSync(fixture,{recursive:true});}
});
test('download failure exits after one attempt and retries only on explicit setup rerun',{skip:process.platform!=='win32'},()=>{
  const fixture=failureFixture('offline setup');
  try{
    // The fixture gets its own mutex so it cannot interfere with a real installation.
    const setup=path.join(fixture,'Setup.ps1');
    fs.writeFileSync(setup,fs.readFileSync(setup,'utf8').replace('Local\\Wedex.Setup','Local\\Wedex.InstallFixture.'+path.basename(fixture).replaceAll(' ','')));
    const source=`$ErrorActionPreference='Stop'
$global:FixtureCalls=0
function Invoke-WebRequest {param($Uri,$OutFile,[switch]$UseBasicParsing,$TimeoutSec) $global:FixtureCalls++;throw 'fixture network unavailable'}
& ${quotePS(setup)} -EnvironmentOnly
$firstExit=$LASTEXITCODE;$firstCalls=$global:FixtureCalls
& ${quotePS(setup)} -EnvironmentOnly
$secondExit=$LASTEXITCODE;$secondCalls=$global:FixtureCalls
if($firstExit -ne 1 -or $secondExit -ne 1 -or $firstCalls -ne 1 -or $secondCalls -ne 2){throw 'Failure or manual retry contract changed'}
$fixtureRoot=${quotePS(fixture)}
$staging=@(Get-ChildItem -LiteralPath (Join-Path $fixtureRoot 'runtime') -Force -Directory | Where-Object {$_.Name -like '.setup-*'})
if($staging.Count -ne 0){throw 'Failed setup staging was not cleaned up'}
[PSCustomObject]@{firstExit=$firstExit;secondExit=$secondExit;firstCalls=$firstCalls;secondCalls=$secondCalls;installationRecorded=(Test-Path (Join-Path $fixtureRoot 'runtime/installation.json'));stagingCount=$staging.Count} | ConvertTo-Json -Compress
`;
    const result=runFailureHarness(fixture,source);assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
    assert.match(result.stdout,/未自动重试/);
    const evidence=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
    assert.deepEqual(evidence,{firstExit:1,secondExit:1,firstCalls:1,secondCalls:2,installationRecorded:false,stagingCount:0});
  }finally{fs.rmSync(fixture,{recursive:true});}
});
