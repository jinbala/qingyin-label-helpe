# 发布操作

1. 在 Chrome Web Store Developer Dashboard 注册自己的开发者账号。注册信息、协议接受及注册费由账号所有者处理。
2. 填写 docs/store/publisher.json 中的公开名称、客服邮箱和隐私政策 HTTPS 网址。邮箱将向公众披露，请使用确定愿意公开的地址。
3. 执行 node scripts/prepare-store.mjs，生成 dist/store-submission/。隐私政策草稿需先补齐信息并托管到公开 HTTPS 页面；私有 GitHub 仓库内的文件不是公开隐私政策网址。
4. 用真实扩展界面截图，使用虚构商品及公司信息，避免真实订单、店铺标识、账号、聊天内容或水印。至少一张 1280×800 或 640×400 PNG/JPEG，直角、无额外留白。建议分别展示打印面板、可视化设计器及位置调整。不要将宣传插画伪装成产品截图。
5. 在后台新增条目，上传 qingyin-label-helper.zip；填写 listing.md 中的介绍、单一用途、权限原因和数据处理声明，上传图标、440×280 宣传图及真实截图。
6. 填写审核测试说明。若真实功能的测试需要登录，按审核要求提供授权的测试方式。
7. 初次建议先以不公开列出的方式提交，取得商店安装链接后邀请测试。是否公开列出以发布者最后选择为准；两种方式均需审核。
8. 核对最终内容后提交审核。若取消“审核后自动发布”，审核通过后仍需在有效期内手动发布。

## 从本地开发版迁移

商店扩展 ID 可能与当前按文件夹加载的版本不同。先从当前轻印“备份全部模板”，保留 JSON，再安装商店版并导入。不要先移除原来的轻印。以后只更新同一个商店条目，不反复新建扩展条目。

## 本次状态

本地材料准备不代表已经上传、提交审核或发布成功。以开发者后台显示的条目状态和最终商店链接为准。生成的 submission-status.json 会列出仍缺少的公开信息和截图。

官方流程：https://developer.chrome.com/docs/webstore/publish

图片规格：https://developer.chrome.com/docs/webstore/images

隐私要求：https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
