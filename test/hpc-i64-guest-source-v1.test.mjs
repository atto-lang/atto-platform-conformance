import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const fixtureDir = new URL('../fixtures/hpc-reduction-v1/', import.meta.url);
const bytes = async path => readFile(new URL(path, fixtureDir));
function gitBlobSha1(data) {
  return createHash('sha1')
    .update(Buffer.from('blob ' + data.length + '\0', 'ascii'))
    .update(data).digest('hex');
}

test('canonical HPC i64 guest fixture has reviewed bytes, stable semantics and no parity promotion', async () => {
  const manifest = JSON.parse(await bytes('i64-fixed-tiles.json'));
  assert.equal(manifest.schema, 'attolang.hpc.fixed-i64-tiles/1');
  assert.equal(manifest.evidence, 'FIXTURE_ONLY_NOT_EXECUTED');
  assert.equal(manifest.source, 'fixtures/hpc-reduction-v1/i64-fixed-tiles.atto');
  const source = await bytes('i64-fixed-tiles.atto');
  assert.ok(source.length > 0 && source.length < 4096);
  assert.equal(gitBlobSha1(source), '9deb9935b4f65b4d53de92f200291a28cdb02a79');
  assert.equal(gitBlobSha1(source), manifest.gitBlobSha1);
  assert.equal(manifest.expectedResultI64, '42');
  assert.equal(manifest.tileSize, 4);
  assert.deepEqual(manifest.tilePartialResults, ['10', '26', '30', '-24']);
  assert.equal(manifest.reductionTree, '(tile0 + tile1) + (tile2 + tile3)');
  assert.deepEqual(Object.keys(manifest.backends), ['java', 'llvm', 'net', 'wasm', 'forge']);
  assert.ok(Object.values(manifest.backends).every(state => state === 'NOT_EXECUTED'));
  assert.match(source.toString('utf8'), /pub fnc main\(\): int/);
});

test('i64 host arithmetic checks manifest numbers without claiming guest execution', async () => {
  const manifest = JSON.parse(await bytes('i64-fixed-tiles.json'));
  const tiles = manifest.tilePartialResults.map(BigInt);
  const answer = (tiles[0] + tiles[1]) + (tiles[2] + tiles[3]);
  assert.equal(answer.toString(), manifest.expectedResultI64);
  const signedLimit = (1n << 63n) - 1n;
  assert.ok(tiles.every(x => x >= -signedLimit - 1n && x <= signedLimit));
});

test('shared parameterized i64 guest source is pinned for native and Graal execution', async () => {
  const source = await bytes('i64-parameterized-tiles.atto');
  assert.ok(source.length > 0 && source.length < 4096);
  assert.equal(gitBlobSha1(source), '88795ff752006d020ea08c6585a8b3b03bf641c7');
  const guest = source.toString('utf8');
  assert.match(guest, /pub fnc tile_reduce8\(/);
  assert.match(guest, /pub fnc main\(\): int/);
  assert.match(guest, /return tile4\(a, b, c, d\) \+ tile4\(e, f, g, h\);/);
});
