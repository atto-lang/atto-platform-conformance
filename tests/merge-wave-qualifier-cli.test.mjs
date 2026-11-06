import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, symlinkSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../bin/merge-wave-qualifier.mjs', import.meta.url));
function with_temp_file(bytes, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'atto-merge-wave-cli-'));
  try {
    const path = join(dir, 'snapshot.json');
    writeFileSync(path, bytes);
    return fn(path, dir);
  } finally {
    rmSync(dir, {recursive:true, force:true});
  }
}
function run(path) {
  return spawnSync(process.execPath, [cli, path], {encoding:'utf8', timeout:5000, maxBuffer:64 * 1024});
}
const blocked = JSON.stringify({schema_version:1, as_of:new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), candidates:[]});

test('bounded CLI reads a real file and reports a blocked, non-authorizing snapshot', () =>
  with_temp_file(blocked, path => {
    const result = run(path);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /"status": "BLOCKED"/);
    assert.equal(result.signal, null);
  })
);
test('oversized file is refused before parsing or output', () =>
  with_temp_file(Buffer.alloc(2_000_001, 32), path => {
    const result = run(path);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /at most 2MB/);
    assert.equal(result.stdout, '');
  })
);
test('final-component symlink is refused', () =>
  with_temp_file(blocked, (path, dir) => {
    const link = join(dir, 'link.json');
    symlinkSync(path, link);
    const result = run(link);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /FAIL_CLOSED/);
    assert.equal(result.stdout, '');
  })
);
test('directory is refused as an input source', () =>
  with_temp_file(blocked, (_path, dir) => {
    const result = run(dir);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /regular file/);
    assert.equal(result.stdout, '');
  })
);
test('malformed UTF-8 fails closed', () =>
  with_temp_file(Buffer.from([0xc3, 0x28]), path => {
    const result = run(path);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /FAIL_CLOSED/);
    assert.equal(result.stdout, '');
  })
);
test('invalid future timestamp returns input error, not eligibility', () =>
  with_temp_file(JSON.stringify({schema_version:1,as_of:'2099-01-01T00:00:00Z',candidates:[]}), path => {
    const result = run(path);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /future-dated/);
    assert.equal(result.stdout, '');
  })
);
