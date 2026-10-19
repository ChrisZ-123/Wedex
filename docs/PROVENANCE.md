# Source provenance and licensing

## Release scope

Wedex is published as the standalone repository `ChrisZ-123/Wedex`. The v0.1.0 preview is prepared from the current Webot implementation with Wedex-specific packaging and documentation. It does not import the Qodex repository or its Git history. No private deployment state, credentials, historical chat or account sessions belong in the public source or release archive.

The maintainer authorized MIT licensing for code they own or are authorized to license. [LICENSE](../LICENSE) is that grant. It does not assign ownership of third-party code or override third-party notices. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Known source relationships

| Component | Provenance and treatment |
| --- | --- |
| WeChat transport and login/media adaptation | `src/wechat.js` records adaptation from Tencent `openclaw-weixin` 2.4.10. Related QR/login/media behavior in `src/assistant.js` follows that implementation. Retain Tencent's full MIT notice. |
| Codex RPC and isolation settings | Webot's Codex adapter records adaptation from an earlier QQ Codex bridge. The relevant `codex-client.js` and `codex-rpc.js` were introduced in maintainer commit `ff8c408`, after the upstream base below. This relationship is acknowledged rather than describing all source as newly authored. |
| Application and packaging | Current Webot chat, memory, media, console, storage and lifecycle implementation, plus Wedex-specific launcher/runtime/release changes. Maintainer-authorized contributions are MIT. |
| QR dependency | `qrcode` 1.5.4 is MIT, copyright Ryan Day; retain its supplied notice and dependency license files. |
| Downloaded runtimes | Node.js and the official Codex distribution are downloaded separately. Their own license and third-party notices remain applicable; Wedex's MIT grant does not relicense those distributions. |

Official source references: [Tencent openclaw-weixin](https://github.com/Tencent/openclaw-weixin), [Tencent license](https://github.com/Tencent/openclaw-weixin/blob/main/LICENSE), [qrcode 1.5.4 license](https://github.com/soldair/node-qrcode/blob/v1.5.4/license).

## Earlier QQ bridge boundary

The earlier Qodex work has an upstream base at [`Derpyu520/qq-bridge`, commit `dea3ce8c408a544cf94f52a7de883fbd854e9556`](https://github.com/Derpyu520/qq-bridge/tree/dea3ce8c408a544cf94f52a7de883fbd854e9556). A read-only inspection of that fixed Git tree found no LICENSE file. No permission to relicense that upstream source is asserted here. Attribution alone is not treated as permission.

The fixed upstream tree contains DSH/QQ modules and does not contain `codex-client.js` or `codex-rpc.js`; those are additions in the later maintainer commit. A normalized-line comparison of Webot's source modules against the fixed upstream JavaScript sources found only generic imports, directory creation and Promise scaffolding. A second comparison tokenized words and punctuation while ignoring whitespace: it found no contiguous match of 55 or more tokens across Webot's source, public assets, scripts and tests against the fixed upstream JavaScript, HTML, CSS, PowerShell and batch files. No substantial copied block was identified by these checks. Renaming or structural changes can escape such comparisons; this is not proof of independent authorship for every line. The historical adaptation comment is retained as provenance, and no blanket claim that every line is original is made.

Any later finding of substantial code from an unlicensed source must be resolved by permission, removal or an independent replacement before redistribution. Do not silently label that material MIT.

## Dependency audit

Read-only audit on 2026-10-19 of the locally installed dependency tree: all 29 packages in the `qrcode` dependency closure had a supplied license file. Their declared licenses were MIT or ISC. Versions and declarations are listed in [third-party notices](../THIRD_PARTY_NOTICES.md). Installation uses the committed lockfile; preserve package license files when distributing an installed dependency tree.

The source/release ZIP does not include preinstalled `node_modules`, Node.js or Codex binaries. Setup retrieves these separately. This avoids representing dependency or runtime code as newly authored Wedex code.

## 中文说明

本仓库从当前 Webot 实现整理，独立发布，不导入 Qodex Git 历史。维护者只对自己有权授权的代码提供 MIT 许可，腾讯适配代码、npm 依赖和下载的运行组件保留各自声明。历史 QQ 上游固定版本没有发现 LICENSE；本项目不声称可替其授权。来源对比没有发现可确认的实质复制块，但这不等同于逐行原创证明；若后续发现来源不明的实质代码，应先取得许可、移除或独立重写。
