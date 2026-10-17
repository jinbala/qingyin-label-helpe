import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { check, filesIn, moduleRoot } from './check.mjs';

try {
  const manifest = JSON.parse(await readFile(path.join(moduleRoot, 'manifest.json'), 'utf8'));
  const verification = await check();
  // A whitelist makes the build independent of the original software beside it.
  const files = [path.join(moduleRoot, 'manifest.json'), path.join(moduleRoot, 'README.md'), path.join(moduleRoot, 'docs/usage.md'), path.join(moduleRoot, 'THIRD_PARTY_NOTICES.md')];
  for (const directory of ['src', 'assets', 'vendor', 'preview']) files.push(...await filesIn(path.join(moduleRoot, directory)));
  const names = files.map(file => path.relative(moduleRoot, file).split(path.sep).join('/')).sort();
  const dist = path.join(moduleRoot, 'dist'); await mkdir(dist, { recursive: true });
  const list = path.join(dist, '.pack-files.json'), archive = path.join(dist, 'qingyin-label-helper.zip');
  await writeFile(list, JSON.stringify(names));
  try {
    const python = [
      'from pathlib import Path', 'import json,sys,zipfile,os,shutil',
      'root=Path(sys.argv[1]).resolve(); archive=Path(sys.argv[2]).resolve(); listing=Path(sys.argv[3])',
      'assert archive.is_relative_to(root/"dist")',
      'names=json.loads(listing.read_text("utf-8")); temporary=archive.with_suffix(".tmp.zip")',
      'with zipfile.ZipFile(temporary,"w",zipfile.ZIP_DEFLATED,compresslevel=6) as bundle:',
      ' for name in names:',
      '  source=(root/name).resolve(); assert source.is_relative_to(root); bundle.write(source,name)',
      'with zipfile.ZipFile(temporary) as bundle:',
      ' assert bundle.testzip() is None',
      ' manifest=json.loads(bundle.read("manifest.json")); inventory=set(bundle.namelist())',
      ' assert manifest["background"]["service_worker"]=="src/printing/background.mjs"',
      ' assert not any(name.startswith(("tests/","docs/reverse-engineering/","dist/","subplugin-ide/","assets/main","local-labels/")) for name in inventory)',
      ' assert not manifest.get("declarative_net_request")',
      'os.replace(temporary,archive)',
      'unpacked=(archive.parent/"extension").resolve(); assert unpacked.parent==archive.parent and unpacked.is_relative_to(root/"dist")',
      'unpacked.mkdir(parents=True,exist_ok=True)',
      '# Remove obsolete generated files individually; never recurse outside this verified output directory.',
      'for old in list(unpacked.rglob("*")):',
      ' assert old.resolve().is_relative_to(unpacked),str(old)',
      ' if old.is_file() and old.relative_to(unpacked).as_posix() not in inventory: old.unlink()',
      'for old in sorted(unpacked.rglob("*"),key=lambda p:len(p.parts),reverse=True):',
      ' if old.is_dir() and not any(old.iterdir()): old.rmdir()',
      'with zipfile.ZipFile(archive) as bundle:',
      ' for name in names:',
      '  target=(unpacked/name).resolve(); assert target.is_relative_to(unpacked)',
      '  target.parent.mkdir(parents=True,exist_ok=True)',
      '  with bundle.open(name) as source,target.open("wb") as destination: shutil.copyfileobj(source,destination)',
      'resources=[manifest["background"]["service_worker"],manifest["action"]["default_popup"]]+list(manifest.get("icons",{}).values())',
      'for entry in manifest["content_scripts"]: resources+=entry.get("js",[])+entry.get("css",[])',
      'for name in resources: assert (unpacked/name).is_file(),name',
      'assert not (unpacked/"service-worker-loader.js").exists()',
      'assert not (unpacked/"subplugin-ide").exists()',
    ].join('\n');
    const result = spawnSync('python', ['-c', python, moduleRoot, archive, list], { encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'ZIP creation failed.');
  } finally { await unlink(list); }
  const bytes = await readFile(archive);
  const metadata = {
    file: 'local-labels/dist/qingyin-label-helper.zip', bytes: bytes.length,
    unpacked_directory: 'local-labels/dist/extension', standalone_source_directory: 'local-labels',
    unpacked_manifest_resources_verified: true,
    sha256: createHash('sha256').update(bytes).digest('hex'), files: names.length,
    archive_verified: true, standalone: true, legacy_runtime_included: false, verification,
    automated_test_command: 'npm.cmd --prefix local-labels/tests test',
    real_browser_verified: false, real_account_verified: false, physical_print_verified: false,
    live_coexistence_verified: false,
  };
  await writeFile(path.join(dist, 'local-label-build.json'), JSON.stringify(metadata, null, 2) + '\n');
  console.log(JSON.stringify(metadata, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
