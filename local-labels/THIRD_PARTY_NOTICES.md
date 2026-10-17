# 第三方开源依赖

本项目的运行时通用库直接来自 npm 官方包，不从其他商业扩展复制。完整 MIT 许可文本位于 `vendor/`，版本、来源与 SHA-256 位于 `vendor/dependencies.json`；构建时验证校验值。

| 库 | 版本 | 用途 | 来源 | 许可证 |
| --- | --- | --- | --- | --- |
| JsBarcode | 3.12.1 | CODE128 编码 | https://registry.npmjs.org/jsbarcode/-/jsbarcode-3.12.1.tgz | vendor/jsbarcode-LICENSE.txt |
| pdf-lib | 1.17.1 | PDF 文件与图像封装 | https://registry.npmjs.org/pdf-lib/-/pdf-lib-1.17.1.tgz | vendor/pdf-lib-LICENSE.txt |

测试工具 jsdom 与 @napi-rs/canvas 仅用于开发，不打包进扩展，版本锁定在 `tests/package-lock.json`，许可证随 npm 开发依赖安装。
