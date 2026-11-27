import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=p=>readFileSync(new URL('../'+p,import.meta.url));
const blob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
const bytes=read('fixtures/value-loop-recur-v1/manifest.json');
const manifest=JSON.parse(bytes);
const doc=JSON.parse(read('evidence/value-loop-recur-observations-v2.json'));
const pins=[
  [
    "230-stateless-value-loop",
    "2c0359a6d2876958d6fb6831eb0dac3c6548c15b",
    [
      [
        "rs-wasm",
        "atto-lang/atto-source.rs",
        "rs",
        "11ad063c15cf493eb5660c7aaa3aa961da51f171",
        "bfc048678138f2bea6669bb33cb2d9cc037fe740",
        "https://github.com/streempilot-test/contract-conformance-tests/actions/runs/45947337466/job/140334944579",
        "MERGED_FOCUSED_EXECUTION",
        "native and wasm32 hosts of the same Rust compiler; one family"
      ],
      [
        "js-esm",
        "atto-lang/atto-source.js",
        "js",
        "00fe167ac44b99de631f6f84388379054d952b65",
        "400b38cf4e6cdb4bd6d8d0645864aff225e3d486",
        "https://github.com/streempilot-test/contract-conformance-tests/actions/runs/45947833608/job/140336510523",
        "MERGED_FOCUSED_EXECUTION",
        "independent JS program-v2 compiler and generated ESM execution"
      ],
      [
        "java-graalvm",
        "atto-lang/atto-source.java",
        "java",
        "ea83ff9b315d616301040d31539d9389d0996a4c",
        "680f6014b04571179b4e7a843db257fea8b4a6b3",
        "https://github.com/streempilot-test/contract-conformance-tests/actions/runs/45949439905/job/140342249220",
        "MERGED_FOCUSED_EXECUTION_BASELINE_RED",
        "GraalVM JVM, focused suite 4/4; unchanged baseline reproduces five regression failures; no Native Image"
      ],
      [
        "llvm-native",
        "atto-lang/atto-source.llvm",
        "llvm",
        "a8be9cfac34127e0c328d8f20c315e56ebb4eb74",
        "48e6ce8bef37707510ec35aa108a44995eb55e75",
        "https://github.com/streempilot-test/contract-conformance-tests/actions/runs/45949589996/job/140342108204",
        "CANDIDATE_FOCUSED_EXECUTION_REGRESSION_RED",
        "native compiler, O0/O2 exact guest 42; six guest runs and four denials; existing scalar suite red"
      ]
    ]
  ],
  [
    "220-recur-sum",
    "adf984b7e7c7e1dd864460e89db50e47f0ee50dd",
    [
      [
        "rs-wasm",
        "atto-lang/atto-source.rs",
        "rs",
        "535175f38ed09a1c4fcd5e3fd4acce42ce7d0233",
        "5b7a27121bd73668305f47bda04a6eca6e45e830",
        "https://github.com/streempilot-test/contract-conformance-tests/actions/runs/45949439905/job/140341615038",
        "MERGED_FOCUSED_EXECUTION",
        "actual Rust compiler native/Wasm host conformance; closed typed scalar binding only"
      ]
    ]
  ],
  [
    "226-recur-string-state",
    "474f73ee88e95c89f485db6f4a138dc6dd31a64c",
    [
      [
        "rs-wasm",
        "atto-lang/atto-source.rs",
        "rs",
        "535175f38ed09a1c4fcd5e3fd4acce42ce7d0233",
        "5b7a27121bd73668305f47bda04a6eca6e45e830",
        "https://github.com/streempilot-test/contract-conformance-tests/actions/runs/45949439905/job/140341615038",
        "MERGED_FOCUSED_EXECUTION",
        "actual Rust compiler native/Wasm host conformance; closed typed scalar binding only"
      ]
    ]
  ]
];
function validate(d){
 assert.equal(d.schema,'atto.value-loop-recur.observations.v2');
 assert.equal(d.full_parity_certified,false);
 assert.equal(d.manifest_blob,blob(bytes));
 assert.equal(d.cases.length,pins.length);
 for(let i=0;i<pins.length;i++){
  const [id,sha,rows]=pins[i], c=d.cases[i];
  assert.equal(c.id,id);assert.equal(c.source_blob,sha);
  const m=manifest.cases.find(x=>x.id===id);
  assert.equal(m.blob,sha);
  assert.equal(blob(read('fixtures/value-loop-recur-v1/'+m.path)),sha);
  assert.equal(c.observations.length,rows.length);
  for(let j=0;j<rows.length;j++){
   const x=c.observations[j];
   assert.deepEqual([x.profile,x.repo,x.compiler_family,x.commit,x.tree,x.receipt,x.qualification,x.scope],rows[j]);
   assert.equal(x.return_i64,m.expected.return_i64);assert.equal(x.stdout,m.expected.stdout);
  }
  assert.equal(new Set(c.observations.map(x=>x.compiler_family)).size,rows.length);
 }
 assert.ok(Object.values(manifest.profile_status).every(x=>x==='NOT_EXECUTED'));
}
test('exact partial execution receipts including explicitly red regression gates',()=>validate(doc));
test('forbid false parity, receipt spoof, candidate promotion, family duplication and result drift',()=>{
 for(const mutate of [
  d=>d.full_parity_certified=true,
  d=>d.cases[0].observations[3].qualification='MERGED_FOCUSED_EXECUTION',
  d=>d.cases[0].observations[2].scope='Native Image',
  d=>d.cases[0].observations[3].receipt=d.cases[0].observations[0].receipt,
  d=>d.cases[0].observations[3].compiler_family='rs',
  d=>d.cases[1].observations[0].return_i64='44',
  d=>d.cases[2].observations[0].stdout='',
  d=>d.cases[0].source_blob='0'.repeat(40)
 ]){const d=structuredClone(doc);mutate(d);assert.throws(()=>validate(d));}
});
