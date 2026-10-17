import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { SELLER_HOSTS } from '../src/core/core.mjs';

export async function auditIndependence(root) {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  const expected = [...SELLER_HOSTS].map(host => `https://${host}/*`).sort();
  if (JSON.stringify([...manifest.host_permissions].sort()) !== JSON.stringify(expected)) throw new Error('Unexpected host permission.');
  const banned = /lingfeng|凌风|kuajingabc|temu_lable|__LF_|10020|new\s+WebSocket|chrome\.debugger|fabric|templates\.(list|detail)|backgroundRequest/i;
  let files = 0;
  const inspect = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await inspect(file);
      else {
        files++;
        if (!/\.(mjs|js|html|css|svg)$/.test(file)) continue;
        const source = await readFile(file, 'utf8');
        if (banned.test(source)) throw new Error(`Reference dependency found: ${path.relative(root, file)}`);
        for (const match of source.matchAll(/https?:\/\/[^\s'"<>`\\)]+/g)) {
          const url = new URL(match[0]);
          if (['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink'].includes(url.href)) continue;
          if (url.protocol !== 'https:' || !SELLER_HOSTS.has(url.hostname)) throw new Error(`Non-platform URL: ${path.relative(root, file)}`);
        }
      }
    }
  };
  for (const directory of ['src', 'preview', 'assets']) await inspect(path.join(root, directory));
  const vendors = JSON.parse(await readFile(path.join(root, 'vendor/dependencies.json'), 'utf8'));
  if (JSON.stringify(vendors.map(item => item.package).sort()) !== JSON.stringify(['jsbarcode', 'pdf-lib'])) throw new Error('Unexpected runtime dependency.');
  for (const vendor of vendors) {
    if (vendor.license !== 'MIT' || new URL(vendor.source).hostname !== 'registry.npmjs.org') throw new Error('Missing upstream provenance.');
  }
  return { files, runtimeHosts: [...SELLER_HOSTS], remoteTemplates: false, remoteImages: false };
}
