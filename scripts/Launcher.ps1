param([switch]$ValidateOnly,[switch]$Preview)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
. (Join-Path $PSScriptRoot 'Launcher-Process.ps1')
$script:worker=$null
$script:readOut=$null
$script:readErr=$null
$script:lines=[Collections.Generic.List[string]]::new()
$script:buttons=@()
$script:action=''
$script:outEnded=$false
$script:errEnded=$false
$form=[Windows.Forms.Form]::new()
$form.Text='Wedex · 微信私人助手'
$form.ClientSize=[Drawing.Size]::new(760,540)
$form.MinimumSize=[Drawing.Size]::new(776,579)
$form.StartPosition='CenterScreen'
$form.BackColor=[Drawing.Color]::FromArgb(242,245,245)
$form.Font=[Drawing.Font]::new('Microsoft YaHei UI',10)
$taskIcon=[Drawing.Icon]::new((Join-Path $taskRoot 'public\launcher.ico'))
$form.Icon=$taskIcon
$heading=[Windows.Forms.Label]::new()
$heading.Text='Wedex'
$heading.Font=[Drawing.Font]::new('Microsoft YaHei UI',25,[Drawing.FontStyle]::Bold)
$heading.ForeColor=[Drawing.Color]::FromArgb(24,46,50)
$heading.SetBounds(26,18,350,52)
$form.Controls.Add($heading)
$sub=[Windows.Forms.Label]::new()
$sub.Text='微信里的私人 AI 助手 · 原生 Codex · 本地记忆'
$sub.SetBounds(28,73,700,26)
$form.Controls.Add($sub)
$note=[Windows.Forms.Label]::new()
$note.Text='首次自动准备环境；登录与扫码在官方页面完成。关闭此窗口后，后台继续运行。'
$note.SetBounds(28,104,704,45)
$note.ForeColor=[Drawing.Color]::FromArgb(80,98,98)
$form.Controls.Add($note)
$status=[Windows.Forms.TextBox]::new()
$status.AccessibleName='运行状态'
$status.Multiline=$true
$status.ReadOnly=$true
$status.ScrollBars='Vertical'
$status.BackColor=[Drawing.Color]::White
$status.BorderStyle='FixedSingle'
$status.SetBounds(28,260,704,245)
$status.Anchor='Top,Bottom,Left,Right'
$status.Text='正在检查安装环境……'
$form.Controls.Add($status)
function Write-WindowEvidence([string]$EventName,[int]$ExitCode=0) {
  $taskLogs=Join-Path $taskRoot 'logs'
  [IO.Directory]::CreateDirectory($taskLogs) | Out-Null
  $taskEvidence=[PSCustomObject]@{event=$EventName;time=[DateTime]::UtcNow.ToString('o');pid=$PID;title=$form.Text;visible=$form.Visible;action=$script:action;exitCode=$ExitCode;preview=[bool]$Preview}
  [IO.File]::WriteAllText((Join-Path $taskLogs 'launcher-status.json'),($taskEvidence|ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
}
function Invoke-LauncherAction([string]$Action) {
  if($script:worker -or $Preview){return}
  $taskInfo=New-LauncherProcessInfo (Join-Path $PSScriptRoot 'Launcher-Action.ps1') $Action $taskRoot
  try {
    $script:lines.Clear()
    $script:worker=[Diagnostics.Process]::Start($taskInfo)
    $script:readOut=$script:worker.StandardOutput.ReadLineAsync()
    $script:readErr=$script:worker.StandardError.ReadLineAsync()
    $script:outEnded=$false;$script:errEnded=$false
    $script:action=$Action
    foreach($button in $script:buttons){$button.Enabled=$false}
    $status.Text='正在执行，请稍候……'+[Environment]::NewLine
  } catch {
    if($script:worker){$script:worker.Dispose()}
    $script:worker=$null
    $status.Text='无法启动操作：'+$_.Exception.Message
    foreach($button in $script:buttons){$button.Enabled=$true}
  }
}
$entries=@(@('安装 / 检查环境','Install'),@('启动助手','Start'),@('打开控制台','OpenConsole'),@('检查状态','Status'),@('停止助手','Stop'))
for($i=0;$i -lt $entries.Count;$i++) {
  $button=[Windows.Forms.Button]::new()
  $button.Text=$entries[$i][0];$button.Tag=$entries[$i][1]
  $button.Name='action'+$button.Tag;$button.AccessibleName=$button.Text
  if($i -eq 0){$button.SetBounds(28,157,704,36)}else{$button.SetBounds((28+(($i-1)%4)*180),207,164,36)}
  $button.Add_Click({param($sender,$eventArgs) Invoke-LauncherAction $sender.Tag})
  $script:buttons+=,$button;$form.Controls.Add($button)
}
$timer=[Windows.Forms.Timer]::new()
$timer.Interval=100
$timer.Add_Tick({
  if(-not $script:worker){return}
  foreach($stream in @('Out','Err')) {
    for($taskReadCount=0;$taskReadCount -lt 100;$taskReadCount++) {
      $taskRead=if($stream -eq 'Out'){$script:readOut}else{$script:readErr}
      if(-not $taskRead -or -not $taskRead.IsCompleted){break}
      try{$taskLine=$taskRead.GetAwaiter().GetResult()}catch{$taskLine=$null}
      if($null -eq $taskLine) {
        if($stream -eq 'Out'){$script:readOut=$null;$script:outEnded=$true}else{$script:readErr=$null;$script:errEnded=$true}
        break
      }
      $script:lines.Add([string]$taskLine)
      $status.AppendText([string]$taskLine+[Environment]::NewLine)
      if($stream -eq 'Out'){$script:readOut=$script:worker.StandardOutput.ReadLineAsync()}else{$script:readErr=$script:worker.StandardError.ReadLineAsync()}
    }
  }
  if($script:worker.HasExited -and $script:outEnded -and $script:errEnded) {
    $taskExitCode=$script:worker.ExitCode
    if($taskExitCode -eq 0 -and $script:action -eq 'Status') {
      try {
        $taskState=($script:lines -join [Environment]::NewLine)|ConvertFrom-Json
        $taskWechat=switch($taskState.wechat){'connected'{'已连接'} 'unbound'{'请扫码绑定'} 'expired'{'需要重新扫码'} default{$taskState.wechat}}
        $taskCodex=switch($taskState.codex){'ready'{'已登录，就绪'} 'login_required'{'请完成官方登录'} default{$taskState.codex}}
        $status.Text="微信：$taskWechat`r`nCodex：$taskCodex`r`n排队：$($taskState.pending)`r`n可用模型：$($taskState.modelCount)`r`n`r`n在控制台管理模型、记忆、角色和图片。"
      } catch { }
    }
    if($taskExitCode -ne 0){$status.AppendText("`r`n本次操作未完成（退出码 $taskExitCode）。请处理上述原因后手动重试。")}
    Write-WindowEvidence 'action-completed' $taskExitCode
    $script:worker.Dispose();$script:worker=$null
    foreach($button in $script:buttons){$button.Enabled=$true}
  }
})
$form.Add_Shown({
  Write-WindowEvidence 'shown'
  if($Preview) {
    foreach($button in $script:buttons){$button.Enabled=$false}
    $status.Text="环境已就绪 · Node.js 24 / Codex`r`n微信：等待扫码绑定`r`nCodex：等待官方登录`r`n`r`n在打开的控制台中完成登录和绑定，即可开始私聊。`r`n`r`n示例界面，未连接真实账号。"
  } else {Invoke-LauncherAction 'InstallAndOpen'}
})
$form.Add_FormClosing({param($sender,$eventArgs)
  if($script:worker){$eventArgs.Cancel=$true;[Windows.Forms.MessageBox]::Show('请等待当前安装或控制操作完成。后台运行后可以关闭启动页。','Wedex')|Out-Null}
})
$form.Add_FormClosed({$timer.Stop();$timer.Dispose()})
if($ValidateOnly) {
  if($script:buttons.Count -ne 5 -or -not $form.ShowInTaskbar){throw 'Launcher validation failed'}
  Write-Output 'Wedex launcher validated: 5 actions, WinForms, async streamed UTF-8, first-run install/open'
  $timer.Dispose();$form.Dispose();$taskIcon.Dispose();exit 0
}
$timer.Start()
[void]$form.ShowDialog()
$form.Dispose();$taskIcon.Dispose()
