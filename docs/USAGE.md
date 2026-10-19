# 安装与使用 / Usage

## 安装 / Installation

下载 `Wedex-v0.1.0-windows-x64.zip` 并完整解压到长期保留的目录，然后双击 `Wedex.bat`。首次启动会自动安装、启动后台并打开控制台。之后可用「安装/检查」检查或补齐组件，再按需点击「启动助手」或「打开控制台」。

Extract the entire release ZIP into a permanent directory and double-click `Wedex.bat`. First launch installs automatically, starts the backend and opens the console. Later, **Install/check** checks or prepares components again; use **Start** or **Open console** afterward as needed.

需要带系统 `tar.exe` 的 Windows 10/11 x64、Windows PowerShell 5.1 和可访问官方下载及登录服务的网络。安装使用项目目录中的 Node.js 24.22.0、Codex 0.163.0 与锁定依赖，无需预装 Node/npm/Git，默认不需管理员权限，不更改全局 PATH。下载、解压、依赖或任务注册失败时，请按启动页错误处理后重试安装，不要反复点击启动。

Requires Windows 10/11 x64 with the built-in `tar.exe`, Windows PowerShell 5.1 and network access to official downloads and login services. Setup uses project-local pinned runtimes and locked dependencies, without a global PATH change or preinstalled Node/npm/Git. Administrator access is not required by default. If download, extraction, dependency installation or task registration fails, address the displayed error before retrying setup.

## 五个操作 / Five actions

| 启动页操作 / Action | 作用 / Behavior |
| --- | --- |
| 安装/检查 / Install/check | 准备或检查本项目运行环境；需要运行时再点击启动或打开控制台 / Prepare or check the local environment; use Start or Open console afterward when needed. |
| 启动助手 / Start | 启动当前目录部署的独立后台 / Start this directory's backend. |
| 打开控制台 / Open console | 通过启动入口完成本机鉴权并打开控制台 / Open the authenticated console through the launcher. |
| 检查状态 / Status | 查看安装和后台状态 / Show installation and backend status. |
| 停止助手 / Stop | 停止本部署后台 / Stop this deployment's backend. |

关闭窗口不会停止后台。默认不启用登录或开机自启。安装后请保留原目录；计划任务绑定该路径，目录移动后已有同名任务会因入口不匹配而被拒绝，不会自动覆盖。不要同时运行两个副本。`127.0.0.1:3130` 被其他实例占用时，Wedex 明确失败，不关闭或接管对方。

Closing windows leaves the backend running. Automatic start at sign-in or boot is off by default. Keep the installed directory in place: its scheduled task binds that path, and a moved directory will reject the existing task's mismatched entry instead of overwriting it. Do not run two copies simultaneously. A conflict on `127.0.0.1:3130` fails explicitly without stopping or taking over the other process.

## 登录与第一条消息 / Login and first message

1. 在「账号与微信绑定」使用官方 Codex 登录；亲自完成浏览器里的确认。 / Start official Codex login in account settings and complete browser confirmation yourself.
2. 扫描控制台显示的官方 ClawBot 二维码，完成手机确认或验证码。 / Scan the official ClawBot QR code and complete any phone confirmation or verification code.
3. 刷新状态，确认账号和微信就绪，再从绑定微信账号发送私聊。 / Refresh status, confirm both connections are ready, then send a private message from the bound account.

没有 API key 输入或凭据迁移步骤。登录过期时重新执行对应官方流程。可用模型、推理强度和服务档位以账号目录为准；保存设置从下一轮生效，组合不可用时会报错。

There is no API-key setup or credential migration. Repeat the corresponding official flow when login expires. Model, effort and tier choices come from the current account catalog. Saved settings apply to the next turn; unsupported combinations fail explicitly.

## 聊天、图片与记忆 / Chat, images and memory

- 普通私聊保留上下文；「重置对话上下文」重置模型上下文，保留历史及可管理记忆。 / Private chat maintains context. Resetting context preserves history and managed memory.
- 明确说「记住……」提出记忆操作；控制台可编辑、置顶、启停和查看版本。模型不能覆盖置顶内容或伪造来源。 / Explicitly request memory changes; the console supports editing, pinning, enabling and version review. The model cannot overwrite pinned entries or invent their provenance.
- 「角色」接受 `.txt` / `.md` 或粘贴文本，选择后下一轮生效。 / Roles accept text/Markdown files or pasted text and apply to later turns.
- 发送图片后询问内容；文字和图片可能分开到达，按实际收到的内容处理。 / Send an image with a question; text and image may arrive separately and are handled as received.
- 生图示例：「画一只坐在窗边的橘猫」。改图时指出具体图片和修改要求。精确引用只在通道提供真实字段时成立，多图来源不清会明确提示。 / Request image creation explicitly. For edits, name the image and changes. Exact references require actual channel fields; ambiguous image selection is reported.
- 语音只处理通道已有转写。表情默认关闭，需显式添加本地图片和含义。 / Voice uses existing channel transcription only. Stickers are off until explicitly enabled and populated with local images and meanings.

## 队列与失败 / Queue and failures

同一会话顺序处理。忙碌或等候登录时，新消息先保存再排队。暂停会取消当前运行，暂停期间新消息仍记录；恢复不自动补跑暂停消息。「停止当前运行」只取消本轮。

Each conversation runs sequentially. Messages received while busy or awaiting login are saved and queued. Pausing cancels the active run and continues recording messages; resuming does not replay paused messages. Stop-current-run cancels only that turn.

收取断线显示退避重连。模型调用或发送失败不自动重试，发送结果不明须先核对手机；重启将未完成记录标记为中断，不重放旧消息。

Receive failures show reconnect backoff. Model calls and sends are not automatically retried. Verify uncertain delivery on your phone before retrying manually. Restart marks unfinished work interrupted without replaying old messages.

## 备份与恢复 / Backup and restore

备份包含模型设置、人格、记忆及版本、角色、表达反馈和本地表情图片，可选文字历史。排除账号凭据、Codex 原生会话、游标、普通收图缓存与生成图片文件。备份本身含私人内容，请妥善保存。

Backups include model settings, persona, memory versions, roles, feedback and local sticker images, with optional text history. They exclude credentials, native Codex sessions, cursors, ordinary received-image caches and generated-image files. Backups still contain private content.

恢复先上传查看预览，再暂停并确认没有进行中或结果不明的运行。预览十分钟有效，相关数据变更后须重新预览。恢复前保存当前可恢复快照；导入的历史仅归档，不进入消息队列。换电脑、换 Windows 用户或新部署须重新官方登录与微信扫码。

Upload a backup to preview it, pause processing, and confirm there are no active or uncertain runs before restoring. Previews expire after ten minutes and must be refreshed after relevant data changes. Restoration saves a recoverable snapshot first. Imported history is archival and never queued. A new computer, Windows user or deployment requires fresh official login and QR binding.

## 常见问题 / Troubleshooting

| 现象 / Symptom | 处理 / Action |
| --- | --- |
| 下载或安装失败 / Setup fails | 检查网络、可写磁盘空间和启动页错误后重试「安装/检查」。 / Check connectivity, writable disk space and the displayed error, then retry Install/check. |
| 任务注册被组织策略禁止 / Task blocked by policy | 保留错误信息并按组织策略处理；不要复制他人登录态或更改全局安全策略。 / Follow your organization's task policy and retain the error; do not copy credentials or change global security policy. |
| 端口冲突 / Port conflict | 由你确认占用者并选择停止哪个部署；Wedex 不会自动停止原程序。 / Identify the owner and decide which deployment to stop yourself. Wedex does not terminate it automatically. |
| 控制台打不开 / Console unavailable | 从启动页重新打开，勿复用过期入口链接；查看状态及本部署日志。 / Reopen through the launcher instead of reusing an expired URL; inspect status and this deployment's logs. |
| 登录或微信失效 / Login expires | 在控制台重新官方登录或扫码。 / Repeat official login or QR binding in the console. |
| 模型或工具不可用 / Model/tool unavailable | 刷新账号目录，核对权限、额度及网络；程序不会自动换模型。 / Refresh the account catalog and check access, quota and connectivity. There is no automatic model switch. |
| 图片或语音不完整 / Missing media information | 等待实际图片到达；无语音转写或真实引用字段时按提示补充文字。 / Wait for actual image delivery; provide text when transcription or reference fields are absent. |

反馈问题时提供脱敏版本、操作、错误和时间；隐藏登录链接、二维码、鉴权信息、聊天与私人媒体。不要上传整个 `state/`、`codex-home/`、`logs/` 或运行目录。

When reporting a problem, provide a redacted version, steps, error and time. Hide login URLs, QR codes, authentication, chat and private media. Do not upload your entire state, Codex home, logs or running directory.
