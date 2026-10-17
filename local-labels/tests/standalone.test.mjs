import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createExtensionServices } from '../src/integration/bridge.mjs';
import { OPEN_PANEL, OPEN_PDF, SETTINGS_REQUEST } from '../src/integration/extension-api.mjs';
import { SETTINGS_SCHEMA } from '../src/core/templates.mjs';
import { auditIndependence } from '../scripts/independence-audit.mjs';
import { auditPageResources } from '../scripts/page-resources.mjs';
import { createSettingsStore } from '../src/printing/settings-store.mjs';
import { defaultTemplates } from '../src/core/templates.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('页面加载的全部间接模块和样式在每个商家站点都可访问', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const result = await auditPageResources(root, manifest);
  assert.equal(result.checkedOrigins, 5); assert(result.checkedResources >= 15);
});

test('复现初始化失败：即使文件存在，漏声明间接导入也必须阻止构建', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  for (const rule of manifest.web_accessible_resources) rule.resources = rule.resources.filter(file => file !== 'src/printing/design-svg.mjs');
  await assert.rejects(auditPageResources(root, manifest), /Page cannot load src\/printing\/design-svg\.mjs.*Import chain: src\/ui\/app\.mjs/);
  const denied = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  for (const rule of denied.web_accessible_resources) rule.matches = rule.matches.filter(pattern => !pattern.includes('agentseller.temu.com/'));
  await assert.rejects(auditPageResources(root, denied), /https:\/\/agentseller\.temu\.com/);
});

test('运行目录仅有平台权限和本地模板，无对方服务、资源或后台协议', async () => {
  const audit = await auditIndependence(root);
  assert.equal(audit.remoteTemplates, false); assert.equal(audit.remoteImages, false);
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.permissions, ['storage', 'activeTab']);
  assert.equal(manifest.host_permissions.length, 5);
  assert.equal(manifest.background.service_worker, 'src/printing/background.mjs');
  assert.equal(manifest.key, undefined); assert.equal(manifest.update_url, undefined);
  assert.equal(manifest.declarative_net_request, undefined);
  assert(manifest.content_scripts.every(entry => entry.js.every(file => !file.includes('fabric'))));
  for (const value of [OPEN_PANEL, OPEN_PDF]) assert.match(value, /^QINGYIN_LABEL_/);
});

test('旧设置只备份一次并停用；新模板存储和 PDF 使用自己的消息', async () => {
  const stored = { qingyinLabelSettings: { templates: [{ kind: 'fabric', content: { objects: [] } }] } }, packets = [];
  const storage = { get: async keys => structuredClone(Object.fromEntries(keys.map(key => [key, stored[key]]))), set: async value => Object.assign(stored, structuredClone(value)) };
  const settingsStore = createSettingsStore(storage);
  globalThis.chrome = {
    storage: { local: storage },
    runtime: { sendMessage: async message => { packets.push(message); return message.type === SETTINGS_REQUEST ? { ok: true, settings: await settingsStore(message.operation, message.patch) } : { ok: true }; } },
  };
  try {
    const service = await createExtensionServices();
    const legacy = structuredClone(stored.qingyinLabelSettings);
    assert.match((await service.loadSettings()).migrationNotice, /备份并停用/);
    assert.deepEqual(stored.qingyinArchivedSettingsV1, legacy);
    assert.deepEqual(await service.loadSettings(), { schema: SETTINGS_SCHEMA });
    await service.saveSettings({ templates: [{ ...defaultTemplates()[0], id: 'own' }] });
    assert.equal(stored.qingyinLabelSettings.schema, SETTINGS_SCHEMA);
    assert.equal((await service.loadSettings()).templates[0].id, 'own');
    assert.deepEqual(stored.qingyinArchivedSettingsV1, legacy);
    assert.equal(service.listTemplates, undefined); assert.equal(service.templateDetail, undefined); assert.equal(service.imageData, undefined);
    await service.openPdf(new TextEncoder().encode('%PDF-1.7'), 'test.pdf');
    assert.equal(packets.filter(packet => packet.type === OPEN_PDF).length, 1);
    assert(packets.some(packet => packet.type === SETTINGS_REQUEST && packet.operation === 'save'));
  } finally { delete globalThis.chrome; }
});

test('项目复制到无原插件的临时目录后仍能独立校验、构建和解包', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'qingyin-independent-'));
  const copy = path.join(temporary, 'project');
  try {
    await mkdir(copy);
    for (const name of ['src', 'assets', 'vendor', 'preview', 'scripts', 'tests', 'manifest.json', 'README.md', 'THIRD_PARTY_NOTICES.md']) {
      await cp(path.join(root, name), path.join(copy, name), { recursive: true, filter: source => !source.split(path.sep).includes('node_modules') });
    }
    await mkdir(path.join(copy, 'docs'));
    await cp(path.join(root, 'docs/usage.md'), path.join(copy, 'docs/usage.md'));
    const result = spawnSync(process.execPath, [path.join(copy, 'scripts/build.mjs')], { cwd: temporary, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(path.join(copy, 'dist/extension/manifest.json'), 'utf8'));
    assert.equal(manifest.version, '1.4.3');
    assert.equal((await readFile(path.join(copy, 'dist/qingyin-label-helper.zip'))).subarray(0, 2).toString(), 'PK');
  } finally {
    const resolved = path.resolve(temporary), parent = path.resolve(tmpdir());
    assert(resolved.startsWith(parent + path.sep) && path.basename(resolved).startsWith('qingyin-independent-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
