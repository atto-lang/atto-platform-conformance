import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateManifestSchema} from '../src/harness.mjs';
const m=JSON.parse(readFileSync(new URL('../fixtures/manifest.json',import.meta.url),'utf8'));
test('portable liveview revision source is a registered five-backend guest fixture',()=>{
  validateManifestSchema(m);
  const entry=m.cases.find(x=>x.id==='liveview-revision-order');
  assert.deepEqual(entry.backends,['java','llvm','net','wasm','forge']);
  assert.equal(entry.expect,'accept');
  const source=readFileSync(new URL('../fixtures/liveview-revision.ores',import.meta.url),'utf8');
  assert.match(source,/pub fnc next_revision/);
  assert.match(source,/pub fnc main\(\): int/);
  // Do not mistake source inventory for actual compiler/guest execution.
});
