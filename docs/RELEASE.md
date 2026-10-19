# Wedex v0.1.0 Preview

Tag: `wedex-v0.1.0`
Windows x64 asset: `Wedex-v0.1.0-windows-x64.zip`

## 中文发布说明

Wedex 把官方 Codex 账号接入你自己的微信私聊。这个独立仓库从当前 Webot 实现整理，保留上下文、角色、版本化记忆、表达反馈、本地表情、历史、备份恢复，以及账号支持的原生联网、看图、生图和改图。

下载发布 ZIP，完整解压到长期保留的目录，双击 `Wedex.bat`。首次自动准备项目本地的官方 Node.js 24.22.0、Codex 0.163.0 和锁定依赖，完成后启动后台并打开控制台。无需预装 Node/npm/Git，默认无需管理员权限，不修改全局 PATH。

启动页提供安装/检查、启动、打开控制台、状态、停止五项操作。后台使用当前用户按需计划任务，默认不开机或登录自启；关闭窗口不会停止后台。固定回环端口 `127.0.0.1:3130`，冲突会明确失败，不接管已有 Webot 或其他程序。

请亲自完成 Codex 官方登录与微信 ClawBot 扫码确认。无需 API key，也不迁移现有账号凭据。只处理绑定主人的私聊；不包含 QQ、群聊、其他联系人、鸣潮或账号托管。

这是预览版。模型与原生工具按账号和通道实际能力提供；语音只用通道转写，精确引用只用实际引用字段。失败不会自动重新生成或重发。旧版 2026-10-14 手机证据与本次发布检查分别记录于 [VALIDATION.md](VALIDATION.md)，仅其中已填写通过的本次条目代表当前版本已完成验证。

## English release notes

发布验证：160 项离线回归、无开发工具 PATH 下的中文空格目录安装、重复安装、真实按需任务与后台启动停止均已通过。当前版本没有重新登录私人账号或进行新的手机实聊，旧版实机记录单独列明。

Wedex connects your own official Codex account to owner-only WeChat private chat. This standalone repository is prepared from the current Webot implementation and includes context, roles, versioned memory, feedback, local stickers, history, backup/restore, and account-supported native search, vision and image generation/editing.

Extract the release ZIP into a permanent directory and double-click `Wedex.bat`. First launch prepares project-local official Node.js 24.22.0, Codex 0.163.0 and locked dependencies, starts the backend and opens the console. No preinstalled Node/npm/Git or global PATH change is needed; administrator access is not required by default.

The five-action launcher manages installation, start, console, status and stop. A current-user on-demand task keeps the backend alive after windows close. Autostart is off by default. An occupied `127.0.0.1:3130` fails explicitly without taking over another instance.

Complete official Codex login and WeChat ClawBot QR confirmation yourself. No API key or copied authentication is needed. Other contacts, groups, QQ, Wuthering Waves and hosted accounts are outside scope.

This is a preview. Models and native tools depend on account and channel support. Voice requires channel transcription; exact references require actual reference fields. Failures do not automatically regenerate or resend. [VALIDATION.md](VALIDATION.md) distinguishes historical 2026-10-14 device evidence from completed checks on this release.

## License and source

Maintainer-authorized code is [MIT](../LICENSE). Third-party components retain their [notices](../THIRD_PARTY_NOTICES.md). Read the [provenance record](PROVENANCE.md) for Tencent adaptation and earlier Codex bridge relationships. No Qodex Git history, preauthenticated accounts or private deployment data are included.
