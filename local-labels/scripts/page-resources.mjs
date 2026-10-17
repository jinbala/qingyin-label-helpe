import { readFile } from 'node:fs/promises';
import path from 'node:path';

// The loader imports these modules into the seller page's isolated world.
// Follow imports and module-relative assets, rather than just checking files exist.
const ENTRIES = ['src/ui/app.mjs', 'src/integration/bridge.mjs', 'src/integration/extension-api.mjs', 'src/ui/style.css'];
const glob = (pattern, value) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(value);

export async function auditPageResources(root, manifest) {
  const graph = new Map();
  async function visit(file, chain = []) {
    if (graph.has(file)) return;
    if (file.startsWith('../') || path.posix.isAbsolute(file)) throw new Error(`Page resource leaves extension directory: ${file}`);
    const source = await readFile(path.join(root, file), 'utf8');
    const route = [...chain, file]; graph.set(file, route);
    if (!/\.(mjs|js)$/.test(file)) return;
    const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g)].map(match => match[1]);
    const assets = [...source.matchAll(/\bnew\s+URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)].map(match => match[1]);
    for (const dependency of [...imports, ...assets]) await visit(path.posix.normalize(path.posix.join(path.posix.dirname(file), dependency)), route);
  }
  for (const entry of ENTRIES) await visit(entry);
  const origins = [...new Set(manifest.content_scripts.filter(entry => entry.js?.some(file => file.endsWith('/integration/loader.js'))).flatMap(entry => entry.matches).map(pattern => new URL(pattern.replace(/\*/g, 'page')).origin))];
  if (!origins.length) throw new Error('No seller origins found for the page loader.');
  for (const origin of origins) for (const [file, chain] of graph) {
    const accessible = manifest.web_accessible_resources?.some(rule => rule.matches?.some(pattern => glob(pattern, `${origin}/page`)) && rule.resources?.some(pattern => glob(pattern, file)));
    if (!accessible) throw new Error(`Page cannot load ${file} on ${origin}; web_accessible_resources is missing this dependency. Import chain: ${chain.join(' -> ')}`);
  }
  return { checkedResources: graph.size, checkedOrigins: origins.length, transitiveImports: 'verified', moduleAssets: 'verified' };
}
