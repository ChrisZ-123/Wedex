$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  Add-Type -AssemblyName System.Security
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $entropy = [System.Text.Encoding]::UTF8.GetBytes('WechatCodexAssistant/v1')
  if ($request.action -eq 'seal') {
    $plainBytes = [System.Text.Encoding]::UTF8.GetBytes([string]$request.value)
    $protectedBytes = [System.Security.Cryptography.ProtectedData]::Protect($plainBytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Out.Write([Convert]::ToBase64String($protectedBytes))
    [Array]::Clear($plainBytes, 0, $plainBytes.Length)
  } elseif ($request.action -eq 'open') {
    $protectedBytes = [Convert]::FromBase64String([string]$request.value)
    $plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protectedBytes, $entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Out.Write([System.Text.Encoding]::UTF8.GetString($plainBytes))
    [Array]::Clear($plainBytes, 0, $plainBytes.Length)
  } else { throw 'Invalid action' }
} catch { [Console]::Error.Write('Windows credential protection failed'); exit 1 }
