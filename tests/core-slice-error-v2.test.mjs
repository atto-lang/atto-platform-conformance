import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(
  new URL('../contracts/core-slice-error-v2.json', import.meta.url), 'utf8'));
const MIN = -(1n << 63n);
const MAX = (1n << 63n) - 1n;

function signed(s) {
  assert.equal(typeof s, 'string', 'i64 must use decimal strings');
  const n = BigInt(s);
  assert.ok(n >= MIN && n <= MAX, `invalid signed i64: ${s}`);
  return n;
}
function normalizeIndex(i, n) {
  if (n <= 0n) return -1n;
  if (i >= 0n) return i < n ? i : -1n;
  return i < -n ? -1n : n + i;
}
function normalizeBound(i, n) {
  if (n < 0n) return -1n;
  if (i >= 0n) return i <= n ? i : -1n;
  return i < -n ? -1n : n + i;
}
function validWindow(o,c,n) {
  return o >= 0n && c >= 0n && n >= 0n && o <= n && c <= n-o;
}
const known = c => c===0n || (c>=1000n&&c<=1008n) ||
  (c>=2000n&&c<=2013n) || (c>=3000n&&c<=3008n) || c===3090n ||
  (c>=4000n&&c<=4008n) || (c>=5000n&&c<=5008n) ||
  (c>=6000n&&c<=6011n) || (c>=7000n&&c<=7008n) ||
  (c>=8000n&&c<=8010n) || (c>=9000n&&c<=9014n);
function group(c) {
  if(!known(c)) return 'None';
  if(c===0n) return {Some:'0'};
  for(const [start,end,grp] of [[1000n,1008n,1000n],[2000n,2013n,2000n],
       [3000n,3008n,3000n],[4000n,4008n,4000n],[5000n,5008n,5000n],
       [6000n,6011n,6000n],[7000n,7008n,7000n],[8000n,8010n,8000n],
       [9000n,9014n,9000n]]) {
    if(c>=start && c<=end) return {Some:grp.toString()};
  }
  if(c===3090n) return {Some:'3000'};
  throw Error('unknown manifest code');
}
function evalScalar(op, args) {
  const x = args.map(signed), [a,b,c,d]=x;
  switch (op) {
    case 'normalize_index': return normalizeIndex(a,b).toString();
    case 'normalize_bound': return normalizeBound(a,b).toString();
    case 'valid_range':
    case 'valid_window': return validWindow(a,b,c);
    case 'valid_endpoints': return normalizeBound(a,c)>=0n && normalizeBound(b,c)>=0n;
    case 'range_len': {
      const p=normalizeBound(a,c),q=normalizeBound(b,c);
      return p<0n||q<0n ? '-1' : p>=q ? '0' : (q-p).toString();
    }
    case 'valid_strided_window':
      return b>0n&&c>=0n&&validWindow(a,0n,d)&&
        (c===0n||(a<d && c-1n <= (d-1n-a)/b));
    case 'valid_reverse_window':
      return b<0n&&c>=0n&&validWindow(a,0n,d)&&
        (c===0n||(a<d && (b===MIN ? c===1n : c-1n<=a/(-b))));
    case 'is_known_core_code': return known(a);
    case 'is_bounds_code': return a===1007n||a===1008n;
    case 'is_retry_advisory_code': return [4003n,5001n,5003n,5005n,5006n].includes(a);
    case 'is_actor_api_code': return a===2012n||a===2013n||(a>=9000n&&a<=9014n);
    case 'code_group': return group(a);
    case 'valid_message_length': return a>=0n&&b>=0n&&a<=b;
    default: throw Error('unknown operation: '+op);
  }
}

test('source contract never self-attests guest execution', () => {
  assert.equal(fixture.schema,'atto.core-slice-error.v2');
  assert.equal(fixture.status,'CANDIDATE_NOT_EXECUTED');
  for(const backend of Object.values(fixture.backend_evidence)) {
    assert.equal(backend.guest,'NOT_EXECUTED');
    assert.equal(backend.borrow_lifetime,'NOT_VERIFIED');
  }
  for(const c of [...fixture.scalar_vectors,...fixture.owned_copy_vectors]) {
    assert.equal(c.guest_status,'NOT_EXECUTED');
  }
  for(const r of fixture.negative_requirements) assert.equal(r.status,'NOT_EXECUTED');
});

test('candidate signed-i64 scalar vector oracle (NOT guest execution)', () => {
  const ids = new Set();
  for(const item of fixture.scalar_vectors) {
    assert.ok(!ids.has(item.id),item.id);
    ids.add(item.id);
    assert.deepEqual(evalScalar(item.op,item.args),item.expected,item.id);
  }
});

test('candidate Array<int> owned scalar-copy vectors (NOT guest execution)', () => {
  for(const testCase of fixture.owned_copy_vectors) {
    const data=testCase.array.map(signed);
    const offset=signed(testCase.offset);
    const count=signed(testCase.count);
    const idx=signed(testCase.index);
    const normalized=normalizeIndex(idx,count);
    const got=!validWindow(offset,count,BigInt(data.length))||normalized<0n
      ? 'None' : {Some:data[Number(offset+normalized)].toString()};
    assert.deepEqual(got,testCase.expected,testCase.id);
  }
});
