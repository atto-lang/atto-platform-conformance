import test from "node:test";
import assert from "node:assert/strict";
import {openSync,closeSync,readSync,lstatSync,fstatSync,readdirSync,constants} from "node:fs";
import {createHash} from "node:crypto";
import {resolve,dirname,join} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const prefix="fixtures/option-result-trap/v1/";
const required=[
  ["ORT-POS-01","positive.ores","guest_stdout"],
  ["ORT-PANIC-01","panic_bypasses_trap.ores","guest_panic"],
  ["ORT-NEG-01","negative/option_is_not_result.ores","compile_reject"],
  ["ORT-NEG-02","negative/result_is_not_option.ores","compile_reject"],
  ["ORT-NEG-03","negative/result_needs_error_type.ores","compile_reject"],
  ["ORT-NEG-04","negative/option_not_implicitly_unwrapped.ores","compile_reject"],
  ["ORT-NEG-05","negative/result_not_implicitly_unwrapped.ores","compile_reject"],
  ["ORT-NEG-06","negative/trap_return_not_unwrapped.ores","compile_reject"],
  ["ORT-NEG-07","negative/trap_nested_not_flattened.ores","compile_reject"]
];
const blobSha=bytes=>createHash("sha1").update(Buffer.from("blob "+bytes.length+"\0")).update(bytes).digest("hex");
const equalStat=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode&&
  a.nlink===b.nlink&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
function safeRead(path) {
  const before=lstatSync(path);
  assert(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1&&before.size>0&&before.size<=131072,
    "nonregular, linked or oversized source fixture");
  const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try {
    const opened=fstatSync(fd);
    assert(equalStat(before,opened),"source identity changed before read");
    const buf=Buffer.alloc(opened.size+1);
    let total=0;
    while(total<buf.length) {
      const n=readSync(fd,buf,total,buf.length-total,total);
      if(n===0)break;
      total+=n;
    }
    assert.equal(total,opened.size,"source size changed during read");
    assert(equalStat(opened,fstatSync(fd))&&equalStat(opened,lstatSync(path)),
      "source identity changed during read");
    return buf.subarray(0,total);
  }finally{closeSync(fd)}
}
function checkInventory(manifest,lock) {
  assert.equal(manifest?.schema,"oreslang.option-result-trap.fixtures/v1");
  assert.equal(manifest?.status,"authored_not_executed");
  assert.deepEqual(manifest?.backends,["java","llvm","wasm","cranelift","net"]);
  assert.equal(lock?.schema,"oreslang.option-result-trap.fixture-lock/v1");
  assert.match(lock?.manifest_blob??"",/^[0-9a-f]{40}$/);
  assert.equal(manifest.cases?.length,required.length);
  assert.equal(lock.cases?.length,required.length);
  const cases=new Map(),pins=new Map();
  for(const c of manifest.cases){
    assert(typeof c?.id==="string"&&!cases.has(c.id),"duplicate fixture id");
    cases.set(c.id,c);
  }
  for(const c of lock.cases){
    assert.deepEqual(Object.keys(c).sort(),["git_blob","id","path"],"unreviewed lock fields");
    assert(typeof c.id==="string"&&!pins.has(c.id),"duplicate lock id");
    assert.match(c.git_blob,/^[0-9a-f]{40}$/);
    pins.set(c.id,c);
  }
  for(const [id,relative,kind] of required){
    const c=cases.get(id),p=pins.get(id),path=prefix+relative;
    assert(c&&p,"missing required fixture id "+id);
    assert.equal(c.path,path);
    assert.equal(p.path,path);
    assert.equal(c.kind,kind);
    if(kind==="compile_reject")assert.equal(c.must_not_launch_guest,true);
    if(kind==="guest_panic"){
      assert.equal(c.expected_diagnostic_contains,"Option::unwrap");
      assert.equal(c.forbidden_stdout,"UNREACHABLE");
    }
    if(kind==="guest_stdout"){
      assert.equal(c.assertion_count,29);
      assert.equal(c.assertions?.length,29);
      assert.equal(new Set(c.assertions).size,29);
      assert.equal(c.expected_stdout,"ORT1:"+"1".repeat(29)+":END");
    }
  }
}
function checkCheckout(base=root){
  const manifestBytes=safeRead(join(base,prefix,"manifest.json"));
  const lock=JSON.parse(safeRead(join(base,prefix,"fixture-lock-v1.json")).toString("utf8"));
  const manifest=JSON.parse(manifestBytes.toString("utf8"));
  checkInventory(manifest,lock);
  assert.equal(blobSha(manifestBytes),lock.manifest_blob,"manifest changed without lock review");
  const allowed=new Set(lock.cases.map(c=>c.path));
  for(const c of lock.cases)
    assert.equal(blobSha(safeRead(join(base,c.path))),c.git_blob,"fixture changed without lock review: "+c.id);
  for(const dir of [prefix,prefix+"negative/"])
    for(const item of readdirSync(join(base,dir),{withFileTypes:true})){
      if(!item.name.endsWith(".ores"))continue;
      assert(item.isFile()&&allowed.has(dir+item.name),"unexpected or linked guest fixture: "+dir+item.name);
    }
}
test("all nine native ORT cases, manifest and source blobs are exactly pinned",()=>{
  checkCheckout();
});
test("mutated inventory, duplicates, backends and stdout fail closed",()=>{
  const manifest={schema:"oreslang.option-result-trap.fixtures/v1",status:"authored_not_executed",
    backends:["java","llvm","wasm","cranelift","net"],
    cases:required.map(([id,relative,kind])=>({id,path:prefix+relative,kind,
      ...(kind==="compile_reject"?{must_not_launch_guest:true}:kind==="guest_panic"?
      {forbidden_stdout:"UNREACHABLE",expected_diagnostic_contains:"Option::unwrap"}:
      {assertion_count:29,assertions:Array.from({length:29},(_,i)=>"assert"+i),
       expected_stdout:"ORT1:"+"1".repeat(29)+":END"})}))};
  const lock={schema:"oreslang.option-result-trap.fixture-lock/v1",manifest_blob:"a".repeat(40),
    cases:required.map(([id,relative])=>({id,path:prefix+relative,git_blob:"b".repeat(40)}))};
  checkInventory(manifest,lock);
  const mutate=fn=>{
    const m=structuredClone(manifest),l=structuredClone(lock);
    fn(m,l);
    assert.throws(()=>checkInventory(m,l));
  };
  mutate(m=>m.cases.pop());
  mutate(m=>m.cases[1].id=m.cases[0].id);
  mutate((m,l)=>l.cases[0].path="../escape.ores");
  mutate(m=>m.backends[3]="forge");
  mutate(m=>m.cases[0].expected_stdout="ORT1:1:END");
  mutate(m=>m.cases[0].assertions[0]=m.cases[0].assertions[1]);
  mutate((m,l)=>l.cases[0].confirmed=true);
});
test("Git blob hashing binds source length and bytes",()=>{
  assert.notEqual(blobSha(Buffer.from("hi")),blobSha(Buffer.from("hi\n")));
  assert.notEqual(blobSha(Buffer.from([0,1])),blobSha(Buffer.from([1])));
});
