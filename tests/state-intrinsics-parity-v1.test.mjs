// Source-only fixture integrity; does not execute or certify a compiler.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

function validate(m,read){
  const need=(ok,msg)=>{if(!ok)throw new Error(msg)};
  const sha=s=>typeof s==="string"&&/^[0-9a-f]{40}$/.test(s);
  need(m.schema==="atto.state-intrinsics-parity.v1"&&m.status==="CANDIDATE_NOT_FULL_PARITY","candidate scope required");
  need(m.sourceFixtureOrigin?.repo==="atto-lang/atto-source.rs"&&sha(m.sourceFixtureOrigin.head)&&sha(m.sourceFixtureOrigin.tree),"immutable fixture origin required");
  const names=["atto","net","hdl","java","realtime","rs","llvm","js","forge","wasm","cranelift"].map(x=>"atto-lang/atto-source."+x).sort();
  need(Array.isArray(m.backends)&&JSON.stringify(m.backends.map(x=>x.repo).sort())===JSON.stringify(names),"exact eleven-backend inventory required");
  need(m.backends.every(x=>x.evidence==="NOT_EXECUTED"),"candidate manifest cannot certify execution");
  need(Array.isArray(m.cases)&&m.cases.length>=10,"missing fixture inventory");
  const seen=new Set(),sources=new Set();let positive=0,negative=0;
  for(const c of m.cases){
    const p=/^fixtures\/state-intrinsics-v1\/(pass|fail)\/([a-z0-9-]+\.atto)$/.exec(c.path);
    need(p&&c.sourcePath==="tests/fixtures/"+p[1]+"/"+p[2],"invalid fixture path or origin path");
    need(!seen.has(c.path)&&!sources.has(c.sourcePath),"duplicate fixture");
    seen.add(c.path);sources.add(c.sourcePath);
    need(sha(c.gitBlob),"invalid fixture blob");
    const e=c.expected;let headers;
    if(p[1]==="pass"){
      need(e?.compile==="accept"&&Number.isSafeInteger(e.exit)&&Array.isArray(e.stdout)&&e.stdout.length>0&&e.stdout.every(x=>typeof x==="string"&&!/[\r\n]/.test(x)),"invalid positive expectation");
      headers=["// expect-exit: "+e.exit,...e.stdout.map(x=>"// expect-stdout: "+x)];positive++;
    }else{
      need(e?.compile==="reject"&&e.noArtifact===true&&typeof e.diagnostic==="string"&&/^E_[A-Z0-9_]+$/.test(e.diagnostic),"invalid rejection expectation");
      headers=["// expect-error: "+e.diagnostic];negative++;
    }
    const actual=read(c.path);
    need(actual?.sha===c.gitBlob,"fixture blob mismatch: "+c.path);
    need(JSON.stringify(actual.content.split(/\r?\n/).filter(x=>/^\/\/ expect-/.test(x)))===JSON.stringify(headers),"fixture directives mismatch: "+c.path);
  }
  need(positive>=3&&negative>=7,"positive or negative coverage reduced");
  return {positive,negative,backends:names.length};
}

function mutations(){
 return [
 ["wrong blob",m=>m.cases[0].gitBlob="0".repeat(40)],
 ["wrong stdout",m=>m.cases[0].expected.stdout[0]="99"],
 ["duplicate case",m=>m.cases.push(m.cases[0])],
 ["missing backend",m=>m.backends.pop()],
 ["duplicate backend",m=>m.backends[0]=m.backends[1]],
 ["false execution claim",m=>m.backends[0].evidence="PASS"],
 ["unsafe path",m=>m.cases[0].path="../outside.atto"],
 ["wrong origin path",m=>m.cases[0].sourcePath="tests/fixtures/fail/other.atto"],
 ["negative artifact allowed",m=>m.cases.find(x=>x.expected.compile==="reject").expected.noArtifact=false],
 ["invalid origin tree",m=>m.sourceFixtureOrigin.tree="latest"],
 ["false parity claim",m=>m.status="PASSED"],
 ["missing negative case",m=>m.cases.splice(m.cases.findIndex(x=>x.expected.compile==="reject"),1)]
 ];
}

const manifest=JSON.parse(readFileSync(new URL('../contracts/state-intrinsics-parity-v1.json',import.meta.url),'utf8'));
function read(path){
  const bytes=readFileSync(new URL('../'+path,import.meta.url));
  const sha=createHash('sha1').update('blob '+bytes.length).update(Buffer.from([0])).update(bytes).digest('hex');
  return {sha,content:bytes.toString('utf8')};
}
test('pinned state intrinsic fixtures and eleven backend candidate inventory',()=>{
  const result=validate(manifest,read);
  assert.ok(result.positive>=3 && result.negative>=7);
  assert.equal(result.backends,11);
});
for(const [name,change] of mutations())test('reject '+name,()=>{
  const m=structuredClone(manifest);change(m);assert.throws(()=>validate(m,read));
});
