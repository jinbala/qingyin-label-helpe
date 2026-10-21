# 轻印标签助手（Qingyin Label Helper）

面向 **TEMU 商家后台**的本地标签打印 Chrome 扩展：勾选备货单、发货单或商品 SKU，批量排版成标签纸，在本机生成 300 / 600 DPI 黑白 PDF，预览后打印。模板、嵌入图片和排版位置都保存在浏览器本地，不经过开发者服务器。

> 扩展源码与完整文档位于 [`local-labels/`](local-labels/) 子目录；本页是仓库入口，扩展本身的详细说明见 [local-labels/README.md](local-labels/README.md)。

当前版本：**1.4.9** ｜ 更新记录：[CHANGELOG.md](local-labels/CHANGELOG.md) ｜ 使用说明：[docs/usage.md](local-labels/docs/usage.md)

## 功能概览

- **从商家后台取数**：读取当前勾选的备货单、发货单或商品 SKU，也支持手动输入编号。
- **按批次打印**：发货单页按“发货批次”读取整批订单；可在不同 SKU / 发货批次之间插入区分提示页。
- **本地模板设计器**：文字、线段、矩形、圆形、商品条码、CODE128、本机图片、表格；支持毫米标尺、图层、锁定、对齐、旋转、复制和撤销重做。
- **标签位置微调**：整张标签、上方文字、条码区域及各文字块可分别偏移和缩放，按模板保存。
- **本地 PDF**：300 / 600 DPI 黑白输出，按标签纸实际毫米尺寸生成；打印页支持预览、打印和下载。
- **模板备份与多页面协作**：整库备份 / 导入 JSON；多标签页只提交各自改动，不互相覆盖。
- **隐私优先**：没有账号、模板服务器、远程图片、统计或广告；模板与 PDF 只在本机处理。

## 快速开始

### 安装

1. 构建或获取可加载目录：
   ```bash
   cd local-labels
   npm install
   npm --prefix tests ci
   npm run build
   ```
2. 打开 Chrome 的 `chrome://extensions`，开启“开发者模式”。
3. 选择“加载已解压的扩展程序”，加载 **`local-labels/dist/extension/`**。
4. 打开 TEMU 商家后台，右下角出现“轻印标签助手”入口；也可点击扩展图标从弹窗打开。

### 升级

先在旧版本中“备份全部模板”，将新版覆盖到原来的同一目录，在扩展管理页点击“重新加载”，然后**刷新所有已打开的商家页面**。不要通过移除扩展再重装来升级。

### 验证

扩展弹窗中的“使用模拟数据验证”页面不需要真实店铺或打印机，可先走一遍“读取 → 预览 → 生成 PDF → 打印页”的流程。

## 支持的页面

- `seller.kuajingmaihuo.com`
- `agentseller.temu.com`
- `seller.temu.com`
- `agentseller-us.temu.com`
- `agentseller-eu.temu.com`

扩展只申请 `storage`、`activeTab` 和上述五个商家域名权限；不读取浏览历史，不保存账号密码或 Cookie，不加载远程代码。

## 仓库结构

```text
local-labels/              可独立复制、独立构建的扩展项目
├── src/                   取数、模板、设计器、排版与 PDF
├── preview/               模拟数据验证页面
├── tests/                 自动化测试
├── scripts/               资源/独立性审计与纯 Node 构建
├── docs/                  使用说明、需求与评审文档
├── manifest.json          MV3 扩展清单
├── README.md              扩展的完整说明
└── dist/extension/        构建产物（不纳入版本库）
```

扩展采用零构建设计：源码可直接加载，运行时仅依赖 `vendor/` 中的 JsBarcode 与 pdf-lib（均 MIT）。

## 开发与测试

```bash
cd local-labels
npm test                 # 自动化测试（73 项）
npm run check            # 清单资源、语法、依赖与独立性审计
npm run build            # 打包 dist/extension 与 zip，并回读校验
npm run coverage         # 覆盖率报告（行覆盖率 90.1%）
```

需要 Node.js 22；Windows PowerShell 中把 `npm` 写成 `npm.cmd`。CI 会连续构建两次并比较安装包 sha256。

更多细节：

- [完整项目说明](local-labels/README.md)
- [安装、使用与排错](local-labels/docs/usage.md)
- [v1.4.9 需求与实施记录](local-labels/docs/需求文档-v1.4.9.md)
- [更新记录](local-labels/CHANGELOG.md)
- [第三方许可](local-labels/THIRD_PARTY_NOTICES.md)

## 已知限制

- 仅支持 Chrome 111+ 与上述五个 TEMU 商家域名。
- 单个 PDF 上限 12 MB；模板与图片合计约 10 MB。大批量请减少不同 SKU、使用 300 DPI 或分批打印。
- TEMU 页面结构或接口变化可能导致读取失败；出错时会给出可读提示，必要时使用手动编号。
- 标签纸留白与居中是软件默认值，实际打印范围取决于打印机，请先试打一张并使用 100% 缩放。
