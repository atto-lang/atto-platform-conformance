import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, symlinkSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {readDopEvidenceJsonFile} from '../verification/dop-evidence-file-v1.mjs';

function withFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'atto-dop-receipt-'));
  try { return fn(dir); } finally { rmSync(dir, {force:true,recursive:true}); }
}
test('normal bounded receipt and manifest parse precisely', () => withFixture(dir => {
  const path = join(dir, 'receipt.json');
  writeFileSync(path, JSON.stringify({contract:'attolang.dop.scalar-guest/1',ciJob:{runId:42}}));
  assert.deepEqual(readDopEvidenceJsonFile(path), {contract:'attolang.dop.scalar-guest/1',ciJob:{runId:42}});
}));
test('duplicate run ID, result state and escaped duplicate keys are denied', () => withFixture(dir => {
  const path = join(dir,'receipt.json');
  for (const json of ['{"status":"PASSED","status":"NOT_EXECUTED"}',
    '{"ciJob":{"runId":1,"runId":2}}', '{"jobId":1,"\u006aobId":2}']) {
    writeFileSync(path,json);
    assert.throws(() => readDopEvidenceJsonFile(path), /github-duplicate-json-key/);
  }
}));
test('leaf symlink to another regular file cannot substitute a reviewed receipt', () => withFixture(dir => {
  const target = join(dir, 'source.json');
  const link = join(dir, 'receipt.json');
  writeFileSync(target, '{"status":"NOT_EXECUTED"}');
  symlinkSync(target,link);
  assert.throws(() => readDopEvidenceJsonFile(link), /evidence-leaf-symlink|ELOOP/);
}));
test('directory and empty file are rejected', () => withFixture(dir => {
  const file = join(dir, 'empty'); writeFileSync(file, '');
  assert.throws(() => readDopEvidenceJsonFile(file), /invalid-evidence-file/);
  assert.throws(() => readDopEvidenceJsonFile(dir), /invalid-evidence-file/);
}));
test('oversized file fails before parsing without reading unlimited bytes', () => withFixture(dir => {
  const file=join(dir,'large'); writeFileSync(file, ' '.repeat(65537));
  assert.throws(() => readDopEvidenceJsonFile(file), /invalid-evidence-file/);
}));
test('malformed JSON, invalid UTF-8, scalar JSON and excessive nesting are rejected', () => withFixture(dir => {
  const file=join(dir,'invalid');
  for (const json of ['{', 'null', '[]', '['.repeat(81) + '0' + ']'.repeat(81)]) {
    writeFileSync(file,json);
    assert.throws(() => readDopEvidenceJsonFile(file), /github-|evidence-/);
  }
  writeFileSync(file,Buffer.from([0xc3,0x28]));
  assert.throws(() => readDopEvidenceJsonFile(file), /evidence-invalid-json/);
}));
test('FIFO is refused without waiting on a writer (on POSIX)', {skip: process.platform === 'win32'}, () => withFixture(dir => {
  const path=join(dir,'fifo');const mk=spawnSync('mkfifo',[path]);
  if (mk.status !== 0) return;
  assert.throws(() => readDopEvidenceJsonFile(path), /invalid-evidence-file/);
}));
test('argument limits reject unbounded or negative reads', () => withFixture(dir => {
  const path=join(dir,'receipt.json'); writeFileSync(path,'{}');
  for(const size of [-1,0,1048577,NaN,Infinity])
    assert.throws(() => readDopEvidenceJsonFile(path,size), /invalid-evidence-file-argument/);
}));
