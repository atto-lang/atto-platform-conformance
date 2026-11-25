import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync, lstatSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve,join} from "node:path";

const root=resolve(fileURLToPath(new URL("..",import.meta.url)));
const read=()=>JSON.parse(readFileSync(join(root,"contracts/erlang-otp-full-aot-fixtures-v1.json"),"utf8"));
const blobSHA=bytes=>createHash("sha1")
  .update(Buffer.from(`blob ${bytes.length}\\0`.replace("\\0","\0"),"utf8"))
  .update(bytes).digest("hex");
const expectedFiles=[
  ["operator_eq_neq_alias_positive","operator-positive.atto","832d839eefbc2a4e9ab65a15882367701886982a","AOT_GUEST_RETURN_42","P0"],
  ["operator_reject_cross_numeric","operator-cross-numeric-reject.atto","2bfbfe915b89add228f0d2f3827b8cd4774c1089","COMPILE_REJECT_NO_IR","AFTER_TYPED_EQUALITY_MIGRATION"],
  ["operator_legacy_equals_strict","operator-legacy-equals-reject.atto","ead96ba331627ea83e02338d0d53cd7400198452","COMPILE_REJECT_NO_IR","AFTER_OPERATOR_MIGRATION"],
  ["static_value_match_positive","value-match-positive.atto","c641c642e2abd8805258feaebe6f0459f69b6163","AOT_GUEST_RETURN_42","P0"]
];

function validate(manifest){
  assert.equal(manifest.schema,"attolang.erlang_otp.full_aot_fixture_registry.v1");
  assert.equal(manifest.status,"SOURCE_ONLY_UNEXECUTED");
  assert.equal(manifest.fixture_root,"fixtures/erlang-otp-full-aot-v1/");
  assert.equal(manifest.fixture_limit_bytes,16384);
  assert.deepEqual(manifest.cases.map(x=>[x.id,x.file,x.git_blob,x.expected,x.gate]),expectedFiles);
  assert.deepEqual(manifest.required_receipts,[
    "EXACT_COMPILER_HEAD_AND_TREE","EXACT_FIXTURE_BLOBS","REAL_COMPILER_FRONTEND",
    "LINKED_FULL_GUEST_AOT_ARTIFACT","EXECUTED_GUEST_EXIT","NEGATIVE_NO_IR",
    "STEPFUL_RUNNER_EVIDENCE","INDEPENDENT_REVIEW"
  ]);
  assert.deepEqual(manifest.receipts,[]);
  assert.deepEqual(manifest.backend_verdicts,{
    java:"NOT_EXECUTED",llvm:"NOT_EXECUTED",net:"NOT_EXECUTED",
    wasm:"NOT_EXECUTED",forge:"NOT_EXECUTED"
  });
  for(const f of manifest.cases){
    const path=join(root,manifest.fixture_root,f.file);
    const st=lstatSync(path);
    assert.equal(st.isFile(),true);
    assert.ok(st.size>0 && st.size<=manifest.fixture_limit_bytes);
    const bytes=readFileSync(path);
    assert.equal(blobSHA(bytes),f.git_blob, `blob drift: ${f.id}`);
  }
  return true;
}
test("all prospective guest fixtures have exact immutable Git-blob pins; NO backend pass",()=>{
  assert.equal(validate(read()),true);
});
test("manifest cannot self-certify, omit negative cases or spoof the legacy migration gate",()=>{
  const m=read();
  const mutations=[
    x=>{x.status="VERIFIED";},
    x=>{x.cases.pop();},
    x=>{x.cases[0].git_blob="0".repeat(40);},
    x=>{x.cases[2].gate="P0";},
    x=>{x.backend_verdicts.java="PASS";},
    x=>{x.receipts=[{guest:true}];},
    x=>{x.required_receipts.pop();},
    x=>{x.fixture_root="../";},
  ];
  for(const mutate of mutations){const x=structuredClone(m);mutate(x);assert.throws(()=>validate(x));}
});
test("fixture content uses Atto operators and already agreed match/over/on/default",()=>{
  const source=readFileSync(join(root,"fixtures/erlang-otp-full-aot-v1/operator-positive.atto"),"utf8");
  for(const op of [" eq "," neq "," !eq "])assert.ok(source.includes(op));
  const match=readFileSync(join(root,"fixtures/erlang-otp-full-aot-v1/value-match-positive.atto"),"utf8");
  for(const token of ["match "," over","on 1","default","end;"])assert.ok(match.includes(token));
});
