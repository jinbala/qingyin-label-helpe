import { auditIndependence } from './independence-audit.mjs';
import { auditPageResources } from './page-resources.mjs';
import { readFile, readdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const moduleRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
export const projectRoot = moduleRoot;

export async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

export async function check() {
  const required = async filename => {
    try { await access(filename); } catch { throw new Error(`Missing resource: ${path.relative(projectRoot, filename)}`); }
  };
  const manifest = JSON.parse(await readFile(path.join(moduleRoot, 'manifest.json'), 'utf8'));
  if (manifest.permissions.some(name => !['storage', 'activeTab'].includes(name)) || manifest.declarative_net_request || manifest.key || manifest.update_url) throw new Error('Standalone manifest contains unexpected legacy capabilities.');
  for (const entry of manifest.content_scripts) {
    for (const filename of [...entry.js || [], ...entry.css || []]) await required(path.join(moduleRoot, filename));
  }
  await required(path.join(moduleRoot, manifest.background.service_worker));
  for (const filename of Object.values(manifest.icons || {})) await required(path.join(moduleRoot, filename));
  const actionIcons = manifest.action?.default_icon;
  for (const filename of typeof actionIcons === 'string' ? [actionIcons] : Object.values(actionIcons || {})) await required(path.join(moduleRoot, filename));
  const files = [
    ...await filesIn(path.join(moduleRoot, 'src')),
    ...await filesIn(path.join(moduleRoot, 'preview')),
    ...await filesIn(path.join(moduleRoot, 'tests')),
    ...await filesIn(path.join(moduleRoot, 'scripts')),
  ];
  let syntaxChecks = 0;
  for (const file of files) {
    if (/\.(mjs|js)$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8', windowsHide: true });
      if (result.status !== 0) throw new Error(result.stderr || `Syntax check failed: ${file}`);
      syntaxChecks++;
      const source = await readFile(file, 'utf8');
      if (file.startsWith(path.join(moduleRoot, 'src') + path.sep) && /message-service-KeDETzND|new WebSocket|127\.0\.0\.1:10020|__LF_PLUGIN_ACTIVE__|__LF_INTERCEPTOR_PROXY__/.test(source)) throw new Error(`Legacy runtime dependency: ${file}`);
      for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)) {
        const dependency = path.resolve(path.dirname(file), match[1]);
        if (file.startsWith(path.join(moduleRoot, 'src') + path.sep) && !dependency.startsWith(moduleRoot + path.sep)) throw new Error(`Runtime import leaves standalone directory: ${file}`);
        await required(dependency);
      }
      for (const match of source.matchAll(/getURL\(['"`]([^'"`$]+)(?:['"`]|\$\{)/g)) {
        await required(path.join(moduleRoot, match[1].split('?')[0]));
      }
    } else if (file.endsWith('.html')) {
      const html = await readFile(file, 'utf8');
      for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
        if (!/^(https?:|data:|blob:)/.test(match[1])) await required(path.resolve(path.dirname(file), match[1]));
      }
    }
  }
  const independenceAudit = await auditIndependence(moduleRoot);
  const pageResourceAccess = await auditPageResources(moduleRoot, manifest);
  const dependencies = JSON.parse(await readFile(path.join(moduleRoot, 'vendor/dependencies.json'), 'utf8'));
  for (const dependency of dependencies) {
    const bytes = await readFile(path.join(moduleRoot, 'vendor', dependency.file));
    if (createHash('sha256').update(bytes).digest('hex') !== dependency.sha256) throw new Error(`Vendor checksum mismatch: ${dependency.file}`);
  }
  return { syntaxChecks, localImports: 'verified', manifestResources: 'verified', vendorChecksums: 'verified', standaloneIsolation: 'verified', independenceAudit, pageResourceAccess };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await check(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
