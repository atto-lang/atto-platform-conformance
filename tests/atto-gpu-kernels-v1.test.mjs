import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const contract = JSON.parse(readFileSync(new URL('../contracts/atto-gpu-kernels-v1.json', import.meta.url), 'utf8'));
const doc = readFileSync(new URL('../docs/ATTO_GPU_KERNELS_V1.md', import.meta.url), 'utf8');
const fixture = readFileSync(new URL('../fixtures/atto-gpu-kernels-v1/saxpy.atto', import.meta.url), 'utf8');
const MAX_I64 = (1n << 63n) - 1n;

function toPositive(value, limit, label) {
  if (typeof value !== 'bigint' || value <= 0n || value > MAX_I64 ||
      typeof limit !== 'bigint' || limit <= 0n || limit > MAX_I64 || value > limit)
    throw new RangeError(label + ' outside admitted geometry');
  return value;
}
function admitLaunch({grid, block, sharedBytes}, caps) {
  if (!Array.isArray(grid) || !Array.isArray(block) || grid.length !== 3 || block.length !== 3)
    throw new TypeError('launch requires exactly three axes');
  const g = grid.map((v, i) => toPositive(v, caps.grid[i], 'grid axis ' + i));
  const b = block.map((v, i) => toPositive(v, caps.block[i], 'block axis ' + i));
  const product = xs => xs.reduce((p, v) => {
    if (p > MAX_I64 / v) throw new RangeError('launch product overflow');
    return p * v;
  }, 1n);
  const threadsPerBlock = product(b);
  if (threadsPerBlock > caps.maxBlockThreads) throw new RangeError('block quota exceeded');
  const groups = product(g);
  if (groups > MAX_I64 / threadsPerBlock) throw new RangeError('total launch overflow');
  if (groups * threadsPerBlock > caps.maxLaunchThreads) throw new RangeError('launch quota exceeded');
  if (typeof sharedBytes !== 'bigint' || sharedBytes < 0n || sharedBytes > caps.maxSharedBytes)
    throw new RangeError('shared memory quota exceeded');
  return {threadsPerBlock, totalThreads: groups * threadsPerBlock};
}
const caps = {
  grid:[65535n,65535n,65535n], block:[1024n,1024n,64n],
  maxBlockThreads:1024n, maxLaunchThreads:100000000n, maxSharedBytes:49152n
};
const normal = {grid:[8n,2n,1n],block:[256n,1n,1n],sharedBytes:0n};

function qualifiesForPhysicalGpuClaim(e) {
  return typeof e?.headSha === 'string' && /^[a-f0-9]{40}$/.test(e.headSha) &&
    typeof e?.treeSha === 'string' && /^[a-f0-9]{40}$/.test(e.treeSha) &&
    typeof e?.compilerDigest === 'string' && /^[a-f0-9]{64}$/.test(e.compilerDigest) &&
    e?.executedSteps > 0 && e?.compilerGuestExecuted === true &&
    e?.targetKind === 'physical-gpu' &&
    typeof e?.deviceId === 'string' && e.deviceId.length > 0 &&
    e?.deviceFenceAcknowledged === true && e?.oracleMatched === true;
}

test('GPU contract is explicitly non-promoting across five compiler backends', () => {
  assert.equal(contract.contract, 'atto-gpu-kernels-v1');
  assert.equal(contract.status, 'PROPOSED_NOT_IMPLEMENTED');
  assert.equal(contract.canonicalTaskContract, 'docs/CPU_GPU_TASK_V2.md');
  assert.equal(Object.keys(contract.backends).length, 5);
  for (const backend of Object.values(contract.backends)) {
    assert.equal(backend.compilerGuest, 'NOT_EXECUTED');
    assert.equal(backend.physicalGpu, 'NOT_EXECUTED');
  }
  assert.equal(contract.features.length, 23);
  assert.equal(new Set(contract.features.map(f => f.id)).size, contract.features.length);
  for (const f of contract.features) {
    assert.match(f.id, /^[a-z][a-z0-9-]+$/);
    assert.ok(['P0','P1','P2'].includes(f.priority));
    assert.equal(f.compilerGuest, 'NOT_EXECUTED');
    assert.equal(f.physicalGpu, 'NOT_EXECUTED');
  }
  assert.ok(contract.negativeCases.length >= 16);
  assert.equal(new Set(contract.negativeCases).size, contract.negativeCases.length);
});

test('proposed native AttoLang syntax is separate from implemented task v2', () => {
  assert.match(doc, /PROPOSED/);
  assert.match(doc, /NOT ACCEPTED BY CURRENT PARSER/);
  assert.match(doc, /No CPU fallback/);
  assert.match(doc, /steps=\[\]/);
  assert.match(fixture, /compute fnc saxpy/);
  assert.match(fixture, /gpu task \{/);
  assert.match(fixture, /launch saxpy\(/);
  assert.match(fixture, /grid: \[/);
  assert.match(fixture, /block: \[/);
  assert.doesNotMatch(fixture, /<<<|>>>/);
});

test('valid 3D launch geometry passes bounded checked host reference', () => {
  assert.deepEqual(admitLaunch(normal, caps),
    {threadsPerBlock:256n,totalThreads:4096n});
});

test('invalid grid, block, workgroup, quotas and overflow fail closed', () => {
  const rejects = [
    {...normal, grid:[0n,2n,1n]},
    {...normal, grid:[-1n,2n,1n]},
    {...normal, grid:[65536n,1n,1n]},
    {...normal, block:[0n,1n,1n]},
    {...normal, block:[1024n,2n,1n]},
    {...normal, block:[MAX_I64,1n,1n]},
    {...normal, sharedBytes:-1n},
    {...normal, sharedBytes:49153n},
    {...normal, grid:[65535n,65535n,65535n]},
    {...normal, grid:[MAX_I64,MAX_I64,MAX_I64]},
    {...normal, grid:[1n,2n]},
    {...normal, grid:[1,2,1]}
  ];
  for (const candidate of rejects)
    assert.throws(() => admitLaunch(candidate, caps), undefined,
      'must reject ' + JSON.stringify(candidate, (_key, val) => typeof val === 'bigint' ? val.toString() : val));
});

test('host-only, zero-step, stale or missing physical-fence receipts never promote GPU support', () => {
  const valid = {
    headSha:'a'.repeat(40),treeSha:'b'.repeat(40),compilerDigest:'c'.repeat(64),
    executedSteps:8,compilerGuestExecuted:true,targetKind:'physical-gpu',
    deviceId:'pci-gpu-0',deviceFenceAcknowledged:true,oracleMatched:true
  };
  assert.equal(qualifiesForPhysicalGpuClaim(valid), true);
  for (const changed of [
    {executedSteps:0}, {executedSteps:null}, {compilerGuestExecuted:false},
    {targetKind:'cpu'}, {targetKind:'mock-gpu'}, {deviceFenceAcknowledged:false},
    {deviceId:''}, {oracleMatched:false},{headSha:'HEAD'}, {treeSha:''},
    {compilerDigest:'not-a-digest'}
  ]) assert.equal(qualifiesForPhysicalGpuClaim({...valid,...changed}),false);
});
