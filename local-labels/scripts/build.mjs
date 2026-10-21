import { readFile, writeFile, mkdir, readdir, rmdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { check, filesIn, moduleRoot } from './check.mjs';

// A minimal ZIP writer and reader so the build needs nothing but Node itself.
// Entries use a fixed 1980-01-01 timestamp and UTF-8 names, which keeps the
// archive byte-identical across runs and machines.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let value = 0; value < 256; value++) {
    let crc = value;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[value] = crc;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function zipArchive(entries) {
  const parts = [], directory = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const body = deflateRawSync(data, { level: 6 }), label = Buffer.from(name, 'utf8'), sum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(sum, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(label.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, label, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(8, 10); entry.writeUInt16LE(0, 12); entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(sum, 16); entry.writeUInt32LE(body.length, 20); entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(label.length, 28); entry.writeUInt32LE(offset, 42);
    directory.push(entry, label);
    offset += local.length + label.length + body.length;
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, central, end]);
}

// Read the archive back the way a ZIP consumer would: central directory, then
// each local header, then inflate and compare length plus CRC. This catches a
// wrong offset or size field, which a write-only test would not.
function readArchive(archive) {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('ZIP 缺少目录结尾记录。');
  const count = archive.readUInt16LE(end + 10);
  const entries = [];
  let cursor = archive.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP 目录项损坏。');
    const method = archive.readUInt16LE(cursor + 10), sum = archive.readUInt32LE(cursor + 16);
    const size = archive.readUInt32LE(cursor + 20), unpackedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28), extraLength = archive.readUInt16LE(cursor + 30), commentLength = archive.readUInt16LE(cursor + 32);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const header = archive.readUInt32LE(cursor + 42);
    if (header + 30 > archive.length || archive.readUInt32LE(header) !== 0x04034b50) throw new Error(`ZIP 条目头损坏：${name}`);
    const dataStart = header + 30 + archive.readUInt16LE(header + 26) + archive.readUInt16LE(header + 28);
    const body = archive.subarray(dataStart, dataStart + size);
    const data = method === 8 ? inflateRawSync(body) : body;
    if (data.length !== unpackedSize || crc32(data) !== sum) throw new Error(`ZIP 条目校验失败：${name}`);
    entries.push({ name, data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function filesUnder(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await filesUnder(target));
    else if (entry.isFile()) found.push(target);
  }
  return found;
}

async function directoriesUnder(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const target = path.join(directory, entry.name);
    found.push(target, ...await directoriesUnder(target));
  }
  return found;
}

// Remove obsolete generated files one by one, then prune directories that the
// current archive no longer populates. Never recurses outside this directory.
async function clearStale(unpacked, inventory) {
  const relative = file => path.relative(unpacked, file).split(path.sep).join('/');
  if (!path.resolve(unpacked).startsWith(path.resolve(moduleRoot, 'dist') + path.sep)) throw new Error('解包目录必须位于 dist 内。');
  await mkdir(unpacked, { recursive: true });
  for (const file of await filesUnder(unpacked)) {
    if (!path.resolve(file).startsWith(path.resolve(unpacked) + path.sep)) throw new Error(`解包目录越界：${file}`);
    if (path.extname(file) && !inventory.has(relative(file))) await unlink(file);
  }
  const directories = (await directoriesUnder(unpacked)).sort((left, right) => right.length - left.length);
  for (const directory of directories) if (!(await readdir(directory)).length) await rmdir(directory);
}

try {
  const manifest = JSON.parse(await readFile(path.join(moduleRoot, 'manifest.json'), 'utf8'));
  const verification = await check();
  // A whitelist makes the build independent of the original software beside it.
  const files = [path.join(moduleRoot, 'manifest.json'), path.join(moduleRoot, 'README.md'), path.join(moduleRoot, 'docs/usage.md'), path.join(moduleRoot, 'THIRD_PARTY_NOTICES.md')];
  for (const directory of ['src', 'assets', 'vendor', 'preview']) files.push(...await filesIn(path.join(moduleRoot, directory)));
  const names = files.map(file => path.relative(moduleRoot, file).split(path.sep).join('/')).sort();
  const dist = path.join(moduleRoot, 'dist'); await mkdir(dist, { recursive: true });
  const archive = path.join(dist, 'qingyin-label-helper.zip'), unpacked = path.join(dist, 'extension');
  const contents = [];
  for (const name of names) {
    const source = path.resolve(moduleRoot, name);
    if (!source.startsWith(moduleRoot + path.sep)) throw new Error(`打包文件越界：${name}`);
    contents.push({ name, data: await readFile(source) });
  }
  await writeFile(archive, zipArchive(contents));

  const packed = readArchive(await readFile(archive)), inventory = new Set(packed.map(entry => entry.name));
  if (inventory.size !== names.length) throw new Error('打包条目数量与清单不一致。');
  const packedManifest = JSON.parse(packed.find(entry => entry.name === 'manifest.json').data.toString('utf8'));
  if (packedManifest.background.service_worker !== 'src/printing/background.mjs') throw new Error('打包清单的后台入口不正确。');
  if (packedManifest.declarative_net_request) throw new Error('打包清单不应包含网络规则。');
  for (const name of inventory) {
    if (/^(tests\/|docs\/reverse-engineering\/|dist\/|subplugin-ide\/|assets\/main|local-labels\/)/.test(name)) throw new Error(`打包清单包含非独立文件：${name}`);
  }
  await clearStale(unpacked, inventory);
  for (const { name, data } of packed) {
    const target = path.resolve(unpacked, name);
    if (!target.startsWith(path.resolve(unpacked) + path.sep)) throw new Error(`解包路径越界：${name}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
  }
  const resources = [packedManifest.background.service_worker, packedManifest.action.default_popup];
  for (const entry of packedManifest.content_scripts) resources.push(...entry.js || [], ...entry.css || []);
  for (const name of [...resources, ...Object.values(packedManifest.icons || {})]) {
    if (!inventory.has(name)) throw new Error(`清单引用的文件缺失：${name}`);
  }
  if (inventory.has('service-worker-loader.js')) throw new Error('打包包含旧后台加载器。');
  if ([...inventory].some(name => name.startsWith('subplugin-ide/'))) throw new Error('打包包含子插件目录。');

  const bytes = await readFile(archive);
  const metadata = {
    file: 'local-labels/dist/qingyin-label-helper.zip', bytes: bytes.length,
    unpacked_directory: 'local-labels/dist/extension', standalone_source_directory: 'local-labels',
    unpacked_manifest_resources_verified: true,
    sha256: createHash('sha256').update(bytes).digest('hex'), files: names.length,
    archive_verified: true, standalone: true, legacy_runtime_included: false, verification,
    automated_test_command: 'npm --prefix local-labels/tests test',
    real_browser_verified: false, real_account_verified: false, physical_print_verified: false,
    live_coexistence_verified: false,
  };
  await writeFile(path.join(dist, 'local-label-build.json'), JSON.stringify(metadata, null, 2) + '\n');
  console.log(JSON.stringify(metadata, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
