# Validation record / 验证记录

Target: Wedex v0.1.0 preview, tag `wedex-v0.1.0`, artifact `Wedex-v0.1.0-windows-x64.zip`.

This record separates historical Webot device evidence from checks performed on this Wedex release. A pending row is not a pass. Do not infer that a new ZIP, clean machine or account has been tested from earlier results.

本记录区分旧版 Webot 实机证据与本次 Wedex 发布验证。「待验证」不代表通过，旧版证据不代表新发布包或干净机器已验证。

## Current release checks / 本次发布检查

| Check | Status | Evidence / limits |
| --- | --- | --- |
| Offline source tests | Passed 2026-10-19 | Project-local Node 24.22.0: `node --test test/*.test.js`, 160 passed, 0 failed, 0 skipped. Includes queue/media/memory/backup, Windows DPAPI fixtures, setup failures and control identity. |
| Fresh extracted path, including spaces | Passed 2026-10-19 | Fresh source copy in a Chinese path with spaces; no runtime, dependencies or user state initially. A separate clean-copy regression passed 158 tests before the final two HTTP identity tests were added. |
| First launch without preinstalled Node/npm/Git | Passed constrained local simulation 2026-10-19 | PATH contained only Windows system/PowerShell directories; command discovery confirmed Node, Git and Codex absent. This is not a newly imaged PC. Setup completed using downloaded local binaries. |
| Official pinned runtime download and locked install | Passed 2026-10-19 | Actual official Node 24.22.0/Codex 0.163.0 archives passed pinned official integrity checks; 29 dependencies installed. Repeated setup skipped download/install. Corrupt-download and single-attempt/manual-retry fixtures passed. |
| Visible Windows PowerShell 5.1 launcher | Passed preview and BAT validation 2026-10-19 | Actual visible WinForms window title and all five native button labels inspected; synthetic screenshot at `images/launcher.png`. UTF-8 stdout/stderr tested under code page 936. Preview does not connect accounts. |
| Current-user on-demand task | Passed 2026-10-19 | Actual default setup created the task and local shortcut in a disposable copy. Principal Interactive/Limited, no triggers; global user/machine PATH unchanged. Only the owned test task was removed afterwards. |
| Start/open/status/stop and repeated start | Passed backend/control integration 2026-10-19 | Fresh default backend reached `login_required`/`unbound`; duplicate start kept one instance, PrepareConsole succeeded, stop/restart produced a new instance. Disposable copy used port 3149 to leave the existing private deployment untouched. Browser dispatch is covered separately by process fixtures. |
| Occupied loopback port / foreign HTTP service | Passed 2026-10-19 | Real ephemeral TCP/HTTP listeners: occupied-port preflight fails, and an unrelated HTTP listener receives only an unauthenticated instance query, never the console token or stop command. Production default remains 3130. |
| Closing launcher/browser/desktop leaves backend alive | Lifecycle boundary passed; new logged-in phone run not performed | Real scoped bootstrap with a 5-second task limit returned Ready/result 0 while its child remained alive after 8 seconds; graceful stop and task removal passed. Full backend integration also survived its bootstrap ending. Old phone/desktop-close evidence is listed below, not relabelled as current. |
| Fresh official Codex login and WeChat QR binding | Pending; user action required | Do not copy existing auth. Record a new phone check separately if performed. |
| Current release phone chat/media/tool behavior | Pending; user action required | Record exact exercised features; no automatic resend for uncertain results. |
| Candidate ZIP contents and credential exclusion | Passed 2026-10-19 | 70 files compared byte-for-byte against the candidate Git commit; runtime, dependencies, credentials, sessions, logs and private evidence excluded. Final tagged asset is rechecked before upload. |
| Public screenshots | Passed 2026-10-19 | Launcher preview uses fictional, unbound state; inspected image contains no credentials, account identifiers or private conversation. |
| Documentation and local links | Passed 2026-10-19; recheck after final edits | Checked 8 Markdown files, 32 relative links, runtime pins against the manifest, and private machine-path markers: no errors. This is a document check, not runtime validation. |
| GitHub Windows CI | Passed candidate; final commit/tag gated separately | Both Windows offline regression and clean portable installation passed for source candidate `4d3f609`: [run](https://github.com/ChrisZ-123/Wedex/actions/runs/39233522047). Final checks are linked from the release. |

The installed official runtime also passed `test/install-runtime-probe.mjs`: initialize, initialized and account/read in an empty independent file credential store, with no account present and child streams fully closed. Ignored, unbound probe directories are retained under test-output; they are not shipped.

## Earlier real-device evidence / 旧版实机证据

Date: **2026-10-14**. These results concern the earlier Webot deployment and were confirmed by its user; private conversations, screenshots, identifiers, machine paths and credentials are not republished.

- The earlier record reports owner private chat, ordinary colloquial language, context, image understanding and original-image return, memory, native web search and image generation as phone-confirmed.
- Continuous image editing and voice operation were phone-confirmed. Voice remains limited to channel-provided transcription.
- A reply during reference testing was confirmed, but that incoming message did not include structured reference fields. It does not establish exact reference support when the channel omits those fields.
- Independent backend operation, desktop-close operation, restarting through the on-demand task, repeated start/stop and login retention were recorded for that earlier deployment.
- Its final independent-backend record reported **148 offline tests**. This historical count must not be presented as the current Wedex suite's result.

以上是 2026-10-14 旧部署的记录及用户确认，未公开私人证据。精准引用仍取决于通道真实字段；语音仍依赖通道转写。148 项是旧版离线记录，不能代替本次测试数。

## How to record a result / 记录规范

For each completed release check, replace its pending status with the date, actual command or user action, result and material limit. Keep clean-machine simulations distinct from fresh-machine evidence. A source test cannot establish phone delivery, account access or launcher visibility. A screenshot cannot establish backend survival after the desktop app exits.

填写本次结果时记录日期、实际命令或用户操作、结果与限制。模拟环境须明确标注；离线测试不证明手机送达、账号可用或窗口可见，截图不证明桌面退出后后台仍存活。
