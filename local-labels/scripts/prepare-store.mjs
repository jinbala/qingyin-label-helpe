import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url), directory = new URL('dist/store-submission/', root);
const require = createRequire(new URL('tests/package.json', root));
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
const publisher = JSON.parse(await readFile(new URL('docs/store/publisher.json', root), 'utf8'));
const metadata = JSON.parse(await readFile(new URL('dist/local-label-build.json', root), 'utf8'));
const archive = await readFile(new URL('dist/qingyin-label-helper.zip', root));
if (createHash('sha256').update(archive).digest('hex') !== metadata.sha256) throw new Error('安装包与校验记录不一致，请重新构建。');
const displayName = String(publisher.displayName || '').trim(), email = String(publisher.supportEmail || '').trim();
const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const validPrivacyUrl = /^https:\/\/[^\s]+$/.test(publisher.privacyPolicyUrl || '');
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
await mkdir(directory, { recursive: true });
await copyFile(new URL('dist/qingyin-label-helper.zip', root), new URL('qingyin-label-helper.zip', directory));
for (const name of ['listing.md', 'review-instructions.md', 'publishing.md']) await copyFile(new URL(`docs/store/${name}`, root), new URL(name, directory));

const icon = await loadImage(await readFile(new URL('assets/icons/master.svg', root)));
const storeIcon = createCanvas(128, 128), iconContext = storeIcon.getContext('2d');
// The existing square artwork spans 4..124; normalize it to 16..112.
iconContext.drawImage(icon, 12.8, 12.8, 102.4, 102.4);
await writeFile(new URL('store-icon-128.png', directory), storeIcon.toBuffer('image/png'));
const promo = createCanvas(440, 280), paint = promo.getContext('2d');
const background = paint.createLinearGradient(0, 0, 440, 280); background.addColorStop(0, '#153a8a'); background.addColorStop(1, '#367df2');
paint.fillStyle = background; paint.fillRect(0, 0, 440, 280);
paint.fillStyle = '#ffffff0f'; paint.beginPath(); paint.arc(410, 30, 160, 0, Math.PI * 2); paint.fill();
paint.fillStyle = '#071d4e35'; paint.beginPath(); paint.roundRect(250, 50, 145, 190, 15); paint.fill();
paint.fillStyle = '#fff'; paint.beginPath(); paint.roundRect(240, 40, 145, 190, 15); paint.fill();
paint.fillStyle = '#dbe7fb'; paint.fillRect(258, 60, 65, 6); paint.fillRect(258, 74, 105, 4); paint.fillRect(258, 85, 92, 4);
paint.strokeStyle = '#25457d'; paint.lineWidth = 1.5; paint.strokeRect(254, 120, 117, 85);
paint.fillStyle = '#25457d'; paint.fillRect(261, 128, 25, 4); paint.fillRect(340, 128, 22, 4);
let x = 265;
for (const width of [3, 2, 5, 2, 4, 2, 3, 6, 2, 4, 2, 5, 3, 2, 4, 2]) { if (x + width > 362) break; paint.fillRect(x, 142, width, 43); x += width + 2; }
paint.fillRect(261, 193, 36, 4); paint.fillRect(333, 193, 29, 4);
paint.drawImage(icon, 35, 57, 170, 170);
await writeFile(new URL('promo-440x280.png', directory), promo.toBuffer('image/png'));

const readyPolicy = Boolean(displayName && validEmail);
const policy = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>轻印标签助手隐私政策</title><style>body{max-width:820px;margin:40px auto;padding:0 24px;font:16px/1.8 system-ui,"Microsoft YaHei",sans-serif;color:#20334e}h1{font-size:28px}h2{font-size:20px;margin-top:30px}.draft{background:#fff3d6;border:1px solid #e8c573;border-radius:8px;padding:14px}a{color:#245cbd}</style></head><body>
${readyPolicy ? '' : '<p class="draft"><strong>草稿，尚不可直接用于上架：</strong>请先确认公开发布者名称和客服邮箱，重新生成后再托管此页面。</p>'}
<h1>轻印标签助手隐私政策</h1><p>更新日期：2026 年 10 月 18 日<br>适用版本：${escape(manifest.version)}<br>发布者：${escape(displayName || '待填写')}</p>
<p>轻印标签助手用于 TEMU 商品标签排版、模板管理和本地 PDF 打印。本政策说明当前版本处理的信息、用途及本机存储方式。</p>
<h2>处理哪些信息</h2><p>当您主动读取商品时，扩展处理所选备货单、发货单或 SKU 编号，以及对应的 SKU/SKC、商品条码、规格、数量和相关订单时间。扩展读取当前商家页面的店铺标识以向正确店铺请求标签，读取受支持页面地址以判断功能入口。我们不读取浏览历史列表。</p>
<p>扩展处理您自行创建或导入的标签模板、嵌入图片、排版位置与模板选择。模板内容可能包含您自行填写的公司名称、地址、联系人、联系方式等信息。请只填写您有权使用的内容。</p>
<h2>信息如何使用与传输</h2><p>商品数据用于生成您要求的标签。商品和翻译读取请求由商家页面利用其现有登录态，发往相应的 TEMU 商家服务。扩展不直接读取或保存您的密码或 Cookie。</p>
<p>模板、图片及 PDF 在本机处理。当前版本没有开发者服务器上传、开发者账户登录、广告、分析统计或第三方数据交易功能。我们不会将上述标签及模板数据发送给开发者服务器。用户主动下载、导出或打印时，文件由浏览器、操作系统和用户选择的打印设备处理。</p>
<h2>保存位置与保留期限</h2><p>模板、图片、选择和位置保存在当前浏览器的扩展本地存储中，直到您删除相应内容或清除/移除扩展。旧格式兼容备份可能继续保留在扩展本机存储中。清除模板列表中的一项不会自动删除您另行导出的文件或历史兼容备份。</p>
<p>为打开打印预览，生成的 PDF 可暂存在扩展的本机 IndexedDB 中。PDF 预览在生成 24 小时后失效；过期记录在后续生成 PDF 时清理，并非保证恰好在 24 小时后物理删除。您可通过清理本扩展数据或移除扩展删除这些本地记录。</p>
<h2>您的控制方式</h2><p>您可取消读取、清空当前打印明细、编辑或删除当前模板，并通过“备份全部模板”将模板和已保存的位置下载为 JSON。导出的文件由您自行保管或删除。移除扩展会清除其本地存储；更换扩展身份或从开发版迁移到商店版前，请先备份再导入。</p>
<h2>权限</h2><p>storage 用于保存本机模板和设置。activeTab 用于用户点击扩展图标后识别当前商家标签页并打开面板。五个 TEMU 商家站点权限用于在对应页面显示入口、读取主动选择的编号及发起允许的标签读取请求，不覆盖其他网站。</p>
<h2>政策变更与联系</h2><p>如果未来增加账号、云端服务或其他数据用途，发布者应先更新政策并按适用要求告知用户。当前联系邮箱：${validEmail ? `<a href="mailto:${escape(email)}">${escape(email)}</a>` : '待填写公开客服邮箱'}。</p>
</body></html>`;
await writeFile(new URL('privacy.html', directory), policy);
const blockers = [];
if (!displayName) blockers.push('缺少公开发布者名称');
if (!validEmail) blockers.push('缺少有效的公开客服邮箱');
if (!validPrivacyUrl) blockers.push('缺少公开 HTTPS 隐私政策网址');
blockers.push('仍需拍摄真实扩展界面截图，至少一张 1280x800 或 640x400');
blockers.push('尚未核对开发者账号登录、注册与实际商店表单');
const status = { version: manifest.version, packageSha256: metadata.sha256, policyDraft: !readyPolicy, privacyPolicyUrlProvided: validPrivacyUrl, privacyPolicyUrlVerified: false, screenshots: [], developerAccountVerified: false, uploaded: false, submitted: false, published: false, blockers };
await writeFile(new URL('submission-status.json', directory), JSON.stringify(status, null, 2) + '\n');
console.log(JSON.stringify({ output: 'local-labels/dist/store-submission', ...status }, null, 2));
