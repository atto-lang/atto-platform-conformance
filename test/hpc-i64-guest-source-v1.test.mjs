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

test('source-only i64 differential vector contract reproduces exact 107-case digest', async () => {
  const contract = JSON.parse(await bytes('i64-parameterized-vectors.json'));
  assert.equal(contract.schema, 'attolang.hpc.i64-differential-v1');
  assert.equal(contract.status, 'FIXTURE_ONLY_NOT_EXECUTED');
  assert.equal(contract.sourceGitBlobSha1, '88795ff752006d020ea08c6585a8b3b03bf641c7');
  assert.equal(contract.vectorCount, 107);
  assert.equal(contract.curatedVectorCount, 11);
  assert.equal(contract.generatedVectorCount, 96);
  assert.equal(contract.seedHex, '5EEDF00DBADC0FFE');
  assert.equal(contract.vectorMatrixSha256,
    'b921d3a36a08917bd5ce7681eb9e00c7b37bb62e8308e0b8615c0c7ffb3ff575');
  assert.ok(Object.values(contract.compilerExecution).every(x => x === 'NOT_EXECUTED'));
  const hi = (1n << 63n) - 1n, lo = -(1n << 63n);
  const vectors = [
    [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n],
    [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n],
    [-1n, -2n, -3n, -4n, -5n, -6n, -7n, -8n],
    [hi, -hi, 10n, -5n, lo, hi, 2n, 3n],
    [lo, hi, hi, -hi, 7n, -7n, 0n, 0n],
    [hi, 0n, 0n, 0n, -hi, 0n, 0n, 0n],
    [lo, 1n, 0n, 0n, hi, -1n, 0n, 0n],
    [10000000000000000n, 1n, -10000000000000000n, 1n,
      -10000000000000000n, 1n, 10000000000000000n, 1n],
    [5000000000n, 4000000000n, -3000000000n, 7n, -9n, 10n, 0n, 0n],
    [255n, 1n, 1n, 1n, 1n, 1n, 1n, 1n],
    [hi, -1n, 0n, 0n, -hi, 1n, 0n, 0n]
  ];
  const mask = (1n << 64n) - 1n;
  let state = BigInt('0x' + contract.seedHex);
  for (let k = 0; k < contract.generatedVectorCount; k++) {
    const row = [];
    for (let j = 0; j < 8; j++) {
      state = (state ^ (state << 13n)) & mask;
      state ^= state >> 7n;
      state = (state ^ (state << 17n)) & mask;
      row.push(state % 1000001n - 500000n);
    }
    vectors.push(row);
  }
  assert.equal(vectors.length, contract.vectorCount);
  const canonical = vectors.map(row => row.join(',') + '\n').join('');
  const digest = createHash('sha256').update(canonical, 'ascii').digest('hex');
  assert.equal(digest, contract.vectorMatrixSha256);
});
