import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {ROOT} from '../src/store.js';

test('Windows launcher parses and its UTF-8 streams work under a Chinese code page',{skip:process.platform!=='win32'},()=>{
  const ps=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const output=execFileSync(ps,['-NoLogo','-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'scripts','Verify-Launcher.ps1')],{encoding:'utf8',timeout:30000,windowsHide:true});
  assert.match(output,/5 actions/);
  assert.match(output,/code page 936/);
});

test('release launcher has five operations and never stops the service on window close',()=>{
  const source=fs.readFileSync(path.join(ROOT,'scripts','Launcher.ps1'),'utf8');
  assert.match(source,/Invoke-LauncherAction 'InstallAndOpen'/);
  for(const action of ['Install','Start','OpenConsole','Status','Stop'])assert.ok(source.includes("'"+action+"'"));
  assert.ok(!source.slice(source.indexOf('$form.Add_FormClosed')).includes("Invoke-LauncherAction 'Stop'"));
  const bat=fs.readFileSync(path.join(ROOT,'Wedex.bat'),'utf8');
  assert.match(bat,/%~dp0scripts\\Launcher[.]ps1/);
  assert.match(bat,/-STA/);
});
