import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,lstat} from "node:fs/promises";

const root = new URL("../fixtures/structural-infer-spread/v1/",import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json",root),"utf8"));
const BACKENDS=["java","llvm","net","wasm"];
const NAMES=new Set([
  "positive-infer-struct","positive-infer-struct-spread","positive-infer-record-spread",
  "positive-infer-type-override","positive-original-unchanged","positive-multiple-spreads",
  "positive-cross-kind-infer","positive-structural-view",
  "negative-duplicate-named","negative-exact-struct-extra","negative-infer-scalar",
  "negative-infer-structural","negative-mutable-borrow","negative-scalar-spread",
  "negative-structural-write","negative-unresolved-spread"
]);

function validate(m){
  assert.equal(m.schemaVersion,1);
  assert.equal(m.scope,"attolang-infer-spread-structural-real-guest-v1");
  assert.equal(m.sourceRoot,"fixtures/structural-infer-spread/v1/");
  assert.equal(m.referenceContract,"contracts/structural-infer-spread/v1/README.md");
  assert.ok(Array.isArray(m.cases));
  assert.equal(m.cases.length,16);
  assert.deepEqual(Object.keys(m.backends).sort(),BACKENDS);
  const names=new Set(),blobs=new Set(),results=new Set();
  let accept=0,reject=0;
  for(const c of m.cases){
    assert.ok(NAMES.has(c.id),"unknown fixture "+c.id);
    assert.ok(!names.has(c.id),"duplicate fixture "+c.id);
    names.add(c.id);
    assert.equal(c.file,c.id+".atto");
    assert.match(c.sourceGitBlobSha1,/^[a-f0-9]{40}$/);
    assert.ok(!blobs.has(c.sourceGitBlobSha1),"duplicate fixture bytes");
    blobs.add(c.sourceGitBlobSha1);
    if(c.id.startsWith("positive-")){
      assert.deepEqual(Object.keys(c).sort(),["id","file","sourceGitBlobSha1","expect","expectedGuestI64","expectedStdout"].sort());
      assert.equal(c.expect,"accept");
      assert.ok(Number.isSafeInteger(c.expectedGuestI64)&&c.expectedGuestI64>0&&c.expectedGuestI64<126);
      assert.ok(!results.has(c.expectedGuestI64),"constant-return compiler would falsify guest evidence");
      assert.equal(c.expectedStdout,"");
      results.add(c.expectedGuestI64);accept++;
    } else {
      assert.deepEqual(Object.keys(c).sort(),["id","file","sourceGitBlobSha1","expect","diagnosticClass","publishArtifacts"].sort());
      assert.equal(c.expect,"reject");
      assert.match(c.diagnosticClass,/^[a-z-]+$/);
      assert.equal(c.publishArtifacts,false);
      reject++;
    }
  }
  assert.deepEqual(names,NAMES);
  assert.equal(accept,8);
  assert.equal(reject,8);
  assert.deepEqual([...results].sort((a,b)=>a-b),[42,43,44,45,46,47,48,49]);
  for(const b of BACKENDS){
    const e=m.backends[b];
    assert.deepEqual(Object.keys(e).sort(),
      ["compilerExecuted","guestExecuted","negativeDiagnosticsVerified","exactCompilerSha","exactArtifactSha256"].sort());
    assert.equal(e.compilerExecuted,false,"no actual compiler execution receipt");
    assert.equal(e.guestExecuted,false,"no actual guest execution receipt");
    assert.equal(e.negativeDiagnosticsVerified,false,"no negative receipt");
    assert.equal(e.exactCompilerSha,null);
    assert.equal(e.exactArtifactSha256,null);
  }
  return true;
}

test("closed 8-positive / 8-negative real-guest source contract cannot claim unexecuted parity",()=>{
  assert.equal(validate(manifest),true);
});

test("every .atto fixture is a byte-for-byte pinned Git blob and a regular source file",async()=>{
  for(const c of manifest.cases){
    const path=new URL(c.file,root);
    const metadata=await lstat(path);
    assert.ok(metadata.isFile()&&!metadata.isSymbolicLink()&&metadata.nlink===1);
    assert.ok(metadata.size>0&&metadata.size<8192);
    const bytes=await readFile(path);
    assert.equal(bytes.length,metadata.size);
    const sha=createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
    assert.equal(sha,c.sourceGitBlobSha1,c.id+" source bytes changed");
    const source=bytes.toString("utf8");
    assert.match(source,/pub fnc main\(\): int \{/);
    assert.ok(source.endsWith("\n"));
  }
});

test("malicious manifest mutation cannot forge case identity or backend execution",()=>{
  const changes=[
    m=>{m.backends.llvm.guestExecuted=true;},
    m=>{m.backends.net.compilerExecuted=true;},
    m=>{m.backends.wasm.exactCompilerSha="abc";},
    m=>{m.backends.java.evidence="passed";},
    m=>{m.cases[0].id=m.cases[1].id;},
    m=>{m.cases[0].sourceGitBlobSha1=m.cases[1].sourceGitBlobSha1;},
    m=>{m.cases.find(x=>x.id==="positive-structural-view").expectedGuestI64=42;},
    m=>{m.cases.find(x=>x.expect==="reject").publishArtifacts=true;},
    m=>{m.cases.pop();}
  ];
  for(const mutate of changes){
    const copy=structuredClone(manifest);
    mutate(copy);
    assert.throws(()=>validate(copy));
  }
});
