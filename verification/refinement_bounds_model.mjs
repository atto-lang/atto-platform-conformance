import assert from 'node:assert/strict';

// Bounded reference oracle, not compiler execution or an SMT proof.
// With comparison constants 0..8, every satisfiable positive-length
// conjunction of at most three clauses has a witness inside 0..10.
const domain = Array.from({length: 11}, (_, i) => i);
const clauses = ['eq','ne','gte','lte','gt','lt'].flatMap(op =>
  Array.from({length: 9}, (_, n) => ({op,n})));

function holds(c, x) {
  switch (c.op) {
    case 'eq': return x === c.n;
    case 'ne': return x !== c.n;
    case 'gte': return x >= c.n;
    case 'lte': return x <= c.n;
    case 'gt': return x > c.n;
    case 'lt': return x < c.n;
    default: throw new Error('unrecognized comparison');
  }
}

function normalize(cs) {
  let min=0, max=Number.MAX_SAFE_INTEGER;
  const excluded=new Set();
  for (const c of cs) {
    switch (c.op) {
      case 'eq': min=Math.max(min,c.n); max=Math.min(max,c.n); break;
      case 'ne': excluded.add(c.n); break;
      case 'gte': min=Math.max(min,c.n); break;
      case 'lte': max=Math.min(max,c.n); break;
      case 'gt': min=Math.max(min,c.n+1); break;
      case 'lt': max=Math.min(max,c.n-1); break;
      default: throw new Error('unrecognized comparison');
    }
  }
  if(min>max) return null;
  for(const n of excluded) if(n<min||n>max) excluded.delete(n);
  if(max-min<excluded.size) {
    let witness=false;
    for(let n=min;n<=max;n++) if(!excluded.has(n)) { witness=true; break; }
    if(!witness) return null;
  }
  return {min,max,excluded};
}

function accepts(interval,x) {
  return interval!==null && x>=interval.min && x<=interval.max &&
    !interval.excluded.has(x);
}

function scalarLength(s) {
  let len=0;
  for(let i=0;i<s.length;) {
    const x=s.charCodeAt(i);
    if(x>=0xD800 && x<=0xDBFF) {
      const y=i+1<s.length ? s.charCodeAt(i+1) : 0;
      if(y<0xDC00||y>0xDFFF) return null;
      i+=2;
    } else if(x>=0xDC00 && x<=0xDFFF) return null;
    else i++;
    len++;
  }
  return len;
}

let checked=0,unsatisfiable=0;
function verify(cs) {
  const interval=normalize(cs);
  const oracle=domain.filter(x=>cs.every(c=>holds(c,x)));
  assert.equal(interval!==null,oracle.length!==0,
    'satisfiability drift: '+JSON.stringify(cs));
  if(interval===null) unsatisfiable++;
  for(const x of domain) assert.equal(accepts(interval,x),oracle.includes(x),
    'membership drift: '+JSON.stringify({cs,x}));
  const reversed=normalize([...cs].reverse());
  assert.equal(reversed===null,interval===null);
  if(interval!==null) {
    assert.equal(reversed.min,interval.min);
    assert.equal(reversed.max,interval.max);
    assert.deepEqual([...reversed.excluded].sort(),[...interval.excluded].sort());
  }
  checked++;
}
for(const a of clauses) {
  verify([a]);
  for(const b of clauses) {
    verify([a,b]);
    for(const c of clauses) verify([a,b,c]);
  }
}

const good=normalize([{op:'gte',n:4},{op:'lte',n:7}]);
assert.deepEqual([good.min,good.max],[4,7]);
for(const s of ['abc','abcd','abcdefg','abcdefgh','😀ab','😀abc',
                '😀abcdef','😀abcdefg']) {
  const n=scalarLength(s);
  assert.equal(accepts(good,n),n>=4&&n<=7);
}
assert.equal(scalarLength('\uD800'),null);
assert.equal(scalarLength('\uDC00'),null);
const impossible=[{op:'gte',n:4},{op:'lte',n:3}];
assert.equal(normalize(impossible),null);
// Unsafe mutant accepting the declaration without interval satisfiability:
// a counterexample MUST be found by this oracle.
assert.equal(domain.some(x=>impossible.every(c=>holds(c,x))),false);

console.log(JSON.stringify({
  proof:'bounded_reference_oracle',
  checkedConstraintTuples:checked,
  unsatisfiableConstraintTuples:unsatisfiable,
  comparisonConstants:'0..8',
  valueDomain:'0..10',
  maximumClauseCount:3,
  compilerExecuted:false,
  wasmOrNativeVerified:false,
  passed:true
}));
