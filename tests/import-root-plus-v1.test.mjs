import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolveRootedSource } from '../tools/resolve-import-root-reference.mjs';

// HOST-ONLY oracle. No compiler backend is invoked by any of these tests.
const contractPath = fileURLToPath(new URL('../contracts/import-root-plus-v1/contract.json', import.meta.url));
const contract = JSON.parse(readFileSync(contractPath,'utf8'));

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'atto-root-contract-'));
  const project = join(base, 'project');
  const withoutManifest = join(base, 'unmarked');
  const outside = join(base, 'outside');
  for (const dir of [
    project, withoutManifest, outside, join(project,'lib'),
    join(project,'src','routes'), join(project,'aliases'), join(project,'mounted')
  ]) mkdirSync(dir,{recursive:true});
  writeFileSync(join(project,'.ores.pkg.toml'), '[package]\nname = "root-contract"\n');
  writeFileSync(join(project,'lib','telemetry.atto'), 'pub fnc value(): int { return 42; }\n');
  writeFileSync(join(project,'src','routes','api.atto'), 'pub fnc route(): int { return 7; }\n');
  writeFileSync(join(outside,'external.atto'),'pub fnc private(): int { return 3; }\n');
  writeFileSync(join(outside,'leak.atto'),'pub fnc private(): int { return 4; }\n');
  symlinkSync('../lib/telemetry.atto',join(project,'aliases','local.atto'));
  symlinkSync(join(outside,'external.atto'),join(project,'aliases','external.atto'));
  symlinkSync(outside,join(project,'mounted','outside-dir'));
  return {base,project,withoutManifest,outside};
}

test('candidate contract explicitly does not certify any backend',()=>{
  assert.equal(contract.schema,'oreslang.import-root-plus/1');
  assert.equal(contract.status,'CANDIDATE_NOT_CERTIFIED');
  assert.equal(contract.marker,'.ores.pkg.toml');
  assert.equal(contract.root_prefix,'+/');
  assert.equal(contract.paths_env,'ORES_PATHS');
  assert.deepEqual(Object.keys(contract.backend_status).sort(),['forge','java','llvm','net','wasm']);
  assert.ok(Object.values(contract.backend_status).every(x=>x==='NOT_EXECUTED'));
  const ids=contract.cases.map(x=>x.id);
  assert.equal(new Set(ids).size,17);
  assert.equal(ids.length,17);
});

for (const entry of contract.cases) {
  test('reference +/ admission: '+entry.id,()=>{
    const f=setup();
    try {
      const root=entry.setup==='manifest_missing'?f.withoutManifest:f.project;
      const specifier=entry.id==='outward-directory-symlink'
        ? '+/mounted/outside-dir/leak.atto' : entry.specifier;
      if(entry.expected==='RESOLVE') {
        const result=resolveRootedSource(root,specifier);
        assert.equal(result.logical_specifier,specifier);
        assert.ok(result.canonical_source.startsWith(f.project+'/'));
      } else {
        assert.throws(()=>resolveRootedSource(root,specifier),/ROOT_IMPORT_/);
      }
    } finally { rmSync(f.base,{recursive:true,force:true}); }
  });
}

test('realpath denies a symlinked external package manifest',()=>{
  const f=setup();
  try {
    rmSync(join(f.project,'.ores.pkg.toml'));
    writeFileSync(join(f.outside,'outside.toml'), '[package]\nname="outside"\n');
    symlinkSync(join(f.outside,'outside.toml'),join(f.project,'.ores.pkg.toml'));
    // An untrusted symlinked marker is not an authority to declare root.
    assert.throws(()=>resolveRootedSource(f.project,'+/lib/telemetry.atto'),/ROOT_IMPORT_/);
  } finally { rmSync(f.base,{recursive:true,force:true}); }
});

test('a lexical prefix alone must never authorize an external symlink',()=>{
  const f=setup();
  try {
    assert.throws(
      ()=>resolveRootedSource(f.project,'+/aliases/external.atto'),
      /ROOT_IMPORT_ESCAPE/
    );
    assert.throws(
      ()=>resolveRootedSource(f.project,'+/mounted/outside-dir/leak.atto'),
      /ROOT_IMPORT_ESCAPE/
    );
  } finally { rmSync(f.base,{recursive:true,force:true}); }
});

test('no negative case may gain a backend parity status',()=>{
  const bad=structuredClone(contract);
  bad.backend_status.java='CERTIFIED';
  assert.notDeepEqual(bad.backend_status,contract.backend_status);
  assert.ok(Object.values(contract.backend_status).every(s=>s==='NOT_EXECUTED'));
});
