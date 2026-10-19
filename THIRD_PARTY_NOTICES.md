# Third-party notices

Wedex's MIT license covers maintainer-authorized contributions. Third-party code and downloaded runtimes keep their own licenses; this file does not transfer their ownership. See [the provenance record](docs/PROVENANCE.md) for the source boundary and historical adapter relationship.

## Tencent openclaw-weixin

The WeChat transport in src/wechat.js and QR/login/media behavior in src/assistant.js are adapted from Tencent's public MIT source and protocol.

Source: https://github.com/Tencent/openclaw-weixin
License: https://github.com/Tencent/openclaw-weixin/blob/main/LICENSE

Tencent is pleased to support the open source community by making openclaw-weixin available.

Copyright (C) 2026 Tencent.  All rights reserved.

openclaw-weixin is licensed under the MIT.

Terms of the MIT:
--------------------------------------------------------------------
Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:
The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## qrcode 1.5.4

Source: https://github.com/soldair/node-qrcode/tree/v1.5.4
The installed package license is retained at node_modules/qrcode/license. Its dependencies retain their supplied license files within node_modules. The source and first-stage release ZIP contain no installed node_modules, Codex or Node.js binary; setup downloads and installs them separately.

The MIT License (MIT)

Copyright (c) 2012 Ryan Day

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Installed dependency closure

The following package versions were inspected read-only on 2026-10-19 against the local locked installation. All 29 packages had a supplied license file. These are package declarations, not a replacement for their full notices. Preserve the supplied license files if redistributing installed dependencies. A later lockfile update requires a fresh inventory.

| Package | Version | Declared license | Supplied license file |
| --- | --- | --- | --- |
| ansi-regex | 5.0.1 | MIT | license |
| ansi-styles | 4.3.0 | MIT | license |
| camelcase | 5.3.1 | MIT | license |
| cliui | 6.0.0 | ISC | LICENSE.txt |
| color-convert | 2.0.1 | MIT | LICENSE |
| color-name | 1.1.4 | MIT | LICENSE |
| decamelize | 1.2.0 | MIT | license |
| dijkstrajs | 1.0.3 | MIT | LICENSE.md |
| emoji-regex | 8.0.0 | MIT | LICENSE-MIT.txt |
| find-up | 4.1.0 | MIT | license |
| get-caller-file | 2.0.5 | ISC | LICENSE.md |
| is-fullwidth-code-point | 3.0.0 | MIT | license |
| locate-path | 5.0.0 | MIT | license |
| p-limit | 2.3.0 | MIT | license |
| p-locate | 4.1.0 | MIT | license |
| p-try | 2.2.0 | MIT | license |
| path-exists | 4.0.0 | MIT | license |
| pngjs | 5.0.0 | MIT | LICENSE |
| qrcode | 1.5.4 | MIT | license |
| require-directory | 2.1.1 | MIT | LICENSE |
| require-main-filename | 2.0.0 | ISC | LICENSE.txt |
| set-blocking | 2.0.0 | ISC | LICENSE.txt |
| string-width | 4.2.3 | MIT | license |
| strip-ansi | 6.0.1 | MIT | license |
| which-module | 2.0.1 | ISC | LICENSE |
| wrap-ansi | 6.2.0 | MIT | license |
| y18n | 4.0.3 | ISC | LICENSE |
| yargs | 15.4.1 | MIT | LICENSE |
| yargs-parser | 18.1.3 | ISC | LICENSE.txt |

## Separately downloaded runtimes

Setup downloads official Node.js 24.22.0 and Codex 0.163.0 into the project directory. Retain the upstream license and notice files included in those distributions. Wedex does not claim ownership of or apply its MIT license to them.

- Node.js: https://github.com/nodejs/node/blob/main/LICENSE
- Codex: https://github.com/openai/codex/blob/main/LICENSE

The repository and release ZIP do not contain an account login, authentication transfer or API key. Runtime licensing is separate from the account and service terms required to use official services.
