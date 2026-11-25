import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const bytes = readFileSync(new URL('../contracts/opto-sync-scoped-v1.json', import.meta.url));
const fixture = JSON.parse(bytes);
const I64_MAX = 9223372036854775807n;
const canonical = /^(?:0|[1-9][0-9]*)$/;

function asI64(raw) {
  if (typeof raw !== 'string' || !canonical.test(raw) || BigInt(raw) > I64_MAX) {
    throw Error('INVALID_DECIMAL');
  }
  return BigInt(raw);
}

function applyVector(row, allowed) {
  const original = row.snapshot;
  const head = asI64(original.checkpoint);
  const records = new Map();
  for (const record of original.records) {
    if (!allowed.has(record.id) || records.has(record.id)) {
      throw Error('INVALID_SNAPSHOT');
    }
    records.set(record.id, {revision: asI64(record.revision), value: record.value});
  }
  const fail = code => ({kind: 'error', code, checkpoint: original.checkpoint});
  const p = row.page;
  if (p.from !== original.checkpoint) return fail('CHECKPOINT_MISMATCH');
  if (asI64(p.to) < head) return fail('CHECKPOINT_REGRESSION');
  if (p.more && p.changes.length === 0) return fail('INVALID_MORE');
  const next = new Map(records);
  let previous = head;
  for (const event of p.changes) {
    if (!allowed.has(event.id)) return fail('SCOPE_VIOLATION');
    const at = asI64(event.at);
    if (at <= previous || at > asI64(p.to)) return fail('OUT_OF_ORDER');
    const revision = asI64(event.revision);
    const old = next.get(event.id);
    if (old && revision <= old.revision) return fail('REVISION_REGRESSION');
    if (event.op === 'upsert') {
      if (typeof event.value !== 'string') return fail('INVALID_UPSERT');
      next.set(event.id, {revision, value: event.value});
    } else if (event.op === 'delete') {
      next.delete(event.id);
    } else return fail('INVALID_OP');
    previous = at;
  }
  // The unacknowledged local overlay is independent of the server's cursor.
  const visible = Object.fromEntries([...next].map(([id, value]) => [id, value.value]));
  for (const [id, value] of Object.entries(row.pending)) {
    if (!allowed.has(id)) return fail('SCOPE_VIOLATION');
    visible[id] = value;
  }
  return {kind:'ok',checkpoint:p.to,rows:visible};
}

test('scoped-sync semantic matrix has five exact independent target identities', () => {
  assert.equal(fixture.feature,'opto-sync-scoped-read-v1');
  assert.equal(fixture.schemaVersion,1);
  assert.equal(fixture.status,'candidate-unattested');
  assert.deepEqual(fixture.backendTargets,['java','llvm','wasm','cranelift','net']);
  assert.equal(new Set(fixture.cases.map(x=>x.id)).size,fixture.cases.length);
  assert.equal(fixture.cases.length,12);
  assert.ok(bytes.length < 64*1024);
  assert.match(createHash('sha256').update(bytes).digest('hex'),/^[0-9a-f]{64}$/);
});

const allowed = new Set(fixture.scope.recordIds);
for (const row of fixture.cases) {
  test('scoped-sync oracle: '+row.id, () => {
    assert.deepEqual(applyVector(row,allowed),row.expected);
  });
}

test('all tested input cursors remain decimal strings beyond JS safe integer range', () => {
  const row=fixture.cases.find(x=>x.id==='large-decimal-cursor');
  assert.ok(row);
  assert.ok(BigInt(row.snapshot.checkpoint)>BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(asI64(row.page.to)-asI64(row.page.from),2n);
  assert.throws(()=>asI64('9007199254740993.0'),/INVALID_DECIMAL/);
  assert.throws(()=>asI64('01'),/INVALID_DECIMAL/);
  assert.throws(()=>asI64('9223372036854775808'),/INVALID_DECIMAL/);
});

test('oracle evidence is not a substitute for real guest compiler execution', () => {
  const supported = fixture.backendTargets.map(backend=>({
    backend,compile:'not-run',guest:'not-run',source_sha:null,
  }));
  assert.equal(supported.every(x=>x.compile==='not-run'&&x.guest==='not-run'),true);
  assert.equal(supported.some(x=>x.source_sha!==null),false);
  assert.equal(supported.length,5);
});
