// Reference process/disk interoperability, not the production broker or scheduler.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const source='define durable actor Ledger as state balance: int = -9223372036854775808; state open: bool = true; state last: int = 9223372036854775807; end';
const golden='4154544f5354303101f9b8eff04a5474590300010000000000000080020101ffffffffffffff7f4191e1156e4df645';
const hash=b=>createHash('sha256').update(b).digest('hex');
const minI64=-(1n<<63n),maxI64=(1n<<63n)-1n;
function checkedI64(value){
  if(typeof value!=='bigint'||value<minI64||value>maxI64)
    throw new RangeError('E_REFERENCE_I64_OVERFLOW');
  return value;
}
assert.ok(process.env.ATTO_JS_COMPILER&&process.env.ATTO_WASM_CODEC,'actual generated compiler artifacts required');
const jsPath=resolve(process.env.ATTO_JS_COMPILER),wasmPath=resolve(process.env.ATTO_WASM_CODEC);
const {compile_durable_scalar_codec_v1:compile}=await import(pathToFileURL(jsPath));
const generated=compile(source);assert.equal(generated.guest_abi,'atto.js.durable.scalar-codec.v1');
const j=await import('data:text/javascript;base64,'+Buffer.from(generated.module_source).toString('base64'));
const js={initial:()=>j.atto_initial_state_v1(),encode:v=>j.atto_encode_state_v1(...v),decode:b=>j.atto_decode_state_v1(Uint8Array.from(b))};
const wasmBytes=readFileSync(wasmPath),mod=new WebAssembly.Module(wasmBytes);assert.deepEqual(WebAssembly.Module.imports(mod),[]);
const e=new WebAssembly.Instance(mod,{}).exports;assert.equal(e.atto_scalar_size_v1(),47n);assert.equal(e.atto_scalar_fields_v1(),3n);
const p=Number(e.__heap_base.value),b=p+64,out=p+128;assert.ok(out+24<=e.memory.buffer.byteLength);
const m=new Uint8Array(e.memory.buffer),d=new DataView(e.memory.buffer);
const w={initial(){assert.equal(e.atto_scalar_initial_v1(b,47n),47n);return m.slice(b,b+47);},encode(v){assert.equal(typeof v[1],'boolean');[checkedI64(v[0]),v[1]?1n:0n,checkedI64(v[2])].forEach((x,i)=>d.setBigInt64(p+8*i,x,true));assert.equal(e.atto_scalar_encode_v1(p,3n,b,47n),47n);return m.slice(b,b+47);},decode(bytes){assert.equal(bytes.length,47);m.set(bytes,b);assert.equal(e.atto_scalar_decode_v1(b,47n,out,3n),3n);return [d.getBigInt64(out,true),d.getBigInt64(out+8,true)===1n,d.getBigInt64(out+16,true)];}};
assert.equal(Buffer.from(js.initial()).toString('hex'),golden);assert.deepEqual(w.initial(),js.initial());
function open(path){const db=new DatabaseSync(path);db.exec('PRAGMA busy_timeout=15000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');return db;}
if(process.argv[2]==='--child'){
 const [, , ,path,mode,backend,id,deltaText]=process.argv;assert.ok(['precommit','postcommit','commit','concurrent'].includes(mode));assert.ok(['js','wasm'].includes(backend));
 const codec=backend==='js'?js:w,delta=checkedI64(BigInt(deltaText)),db=open(path);
 if(mode==='concurrent')console.log('READY');
 try{
  db.exec('BEGIN IMMEDIATE');
  const prior=db.prepare('SELECT delta,revision FROM receipt WHERE id=?').get(id);
  if(prior){if(prior.delta!==deltaText)throw new Error('E_REFERENCE_RECEIPT_MISMATCH');db.exec('COMMIT');console.log('REPLAY '+prior.revision);}
  else{
   const row=db.prepare('SELECT revision,checkpoint FROM actor WHERE id=1').get();
   const [balance,enabled]=codec.decode(row.checkpoint),next=checkedI64(balance+delta),revision=row.revision+1;
   const checkpoint=codec.encode([next,!enabled,next]);
   assert.equal(db.prepare('UPDATE actor SET revision=?,checkpoint=? WHERE id=1 AND revision=?').run(revision,checkpoint,row.revision).changes,1);
   db.prepare('INSERT INTO receipt VALUES(?,?,?)').run(id,deltaText,revision);
   db.prepare('INSERT INTO outbox VALUES(?,?)').run(revision,checkpoint);
   if(mode==='precommit')process.kill(process.pid,'SIGKILL');
   db.exec('COMMIT');
   if(mode==='postcommit')process.kill(process.pid,'SIGKILL');
   console.log('COMMITTED '+revision);
  }
 }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}finally{db.close();}
}else{
 const dir=mkdtempSync(join(tmpdir(),'atto-scalar-disk-'));const path=join(dir,'actor.db');
 try{
  const db=open(path);db.exec('CREATE TABLE actor(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,checkpoint BLOB NOT NULL);CREATE TABLE receipt(id TEXT PRIMARY KEY,delta TEXT NOT NULL,revision INTEGER NOT NULL UNIQUE);CREATE TABLE outbox(revision INTEGER PRIMARY KEY,checkpoint BLOB NOT NULL);');db.prepare('INSERT INTO actor VALUES(1,0,?)').run(js.initial());db.close();
  const min=-(1n<<63n),max=(1n<<63n)-1n;
  function check(revision,expected){const db=open(path);try{const row=db.prepare('SELECT revision,checkpoint FROM actor WHERE id=1').get();assert.equal(row.revision,revision);assert.deepEqual(js.decode(row.checkpoint),expected);assert.deepEqual(w.decode(row.checkpoint),expected);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM receipt').get().n,revision);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n,revision);if(revision){const event=db.prepare('SELECT checkpoint FROM outbox WHERE revision=?').get(revision);assert.deepEqual(event.checkpoint,row.checkpoint);}}finally{db.close();}}
  function turn(mode,backend,id,delta,expected){const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--child',path,mode,backend,id,String(delta)],{encoding:'utf8',timeout:30000,maxBuffer:1<<20});assert.equal(child.error,undefined);if(expected==='SIGKILL'){assert.equal(child.signal,'SIGKILL');assert.equal(child.status,null);assert.equal(child.stdout,'');}else{assert.equal(child.signal,null);assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),expected);}}
  check(0,[min,true,max]);
  turn('postcommit','js','first',1n,'SIGKILL');check(1,[min+1n,false,min+1n]);
  turn('commit','wasm','first',1n,'REPLAY 1');check(1,[min+1n,false,min+1n]);
  turn('precommit','wasm','second',2n,'SIGKILL');check(1,[min+1n,false,min+1n]);
  turn('commit','js','second',2n,'COMMITTED 2');check(2,[min+3n,true,min+3n]);
  turn('commit','wasm','third',4n,'COMMITTED 3');check(3,[min+7n,false,min+7n]);
  turn('commit','js','third',4n,'REPLAY 3');check(3,[min+7n,false,min+7n]);
  // Verify rejection is atomic, including exact bytes of prior receipts and outbox rows.
  function snapshot(){
    const db=open(path);
    try{return {
      actor:db.prepare('SELECT * FROM actor ORDER BY id').all(),
      receipts:db.prepare('SELECT * FROM receipt ORDER BY revision').all(),
      outbox:db.prepare('SELECT * FROM outbox ORDER BY revision').all()
    };}finally{db.close();}
  }
  function rejected(backend,id,delta,code){
    const before=snapshot();
    const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--child',path,'commit',backend,id,String(delta)],{encoding:'utf8',timeout:30000,maxBuffer:1<<20});
    assert.equal(child.error,undefined);assert.equal(child.signal,null);
    assert.equal(child.status,1,child.stderr);assert.equal(child.stdout,'');
    assert.ok(child.stderr.includes(code),child.stderr);
    assert.deepEqual(snapshot(),before);
  }
  for(const backend of ['js','wasm']){
    rejected(backend,'first',2n,'E_REFERENCE_RECEIPT_MISMATCH');
    rejected(backend,'overflow-'+backend,-8n,'E_REFERENCE_I64_OVERFLOW');
    rejected(backend,'outside-'+backend,max+1n,'E_REFERENCE_I64_OVERFLOW');
    check(3,[min+7n,false,min+7n]);
  }
  // Rejected identifiers were not consumed; a valid retry commits once.
  turn('commit','wasm','overflow-wasm',1n,'COMMITTED 4');check(4,[min+8n,true,min+8n]);
  turn('commit','js','overflow-wasm',1n,'REPLAY 4');check(4,[min+8n,true,min+8n]);
  // Hold the write lock until all independent processes reach admission.
  // Four unique messages, each delivered concurrently through both codecs.
  const lock=open(path),children=[];
  lock.exec('BEGIN IMMEDIATE');
  try{
    for(let i=1;i<=4;i++)for(const backend of ['js','wasm']){
      const id='concurrent-'+i,delta=String(i);
      const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--child',path,'concurrent',backend,id,delta],{stdio:['ignore','pipe','pipe']});
      let stdout='',stderr='',readyResolve,doneResolve;
      const ready=new Promise(resolve=>{readyResolve=resolve;});
      const done=new Promise(resolve=>{doneResolve=resolve;});
      const timer=setTimeout(()=>child.kill('SIGKILL'),25000);
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      child.stdout.on('data',chunk=>{stdout+=chunk;if(stdout.startsWith('READY\n'))readyResolve(true);});
      child.stderr.on('data',chunk=>{stderr+=chunk;});
      child.on('error',error=>{readyResolve(false);doneResolve({id,delta,backend,error});});
      child.on('close',(status,signal)=>{clearTimeout(timer);readyResolve(false);doneResolve({id,delta,backend,status,signal,stdout,stderr});});
      children.push({child,ready,done});
    }
    assert.deepEqual(await Promise.all(children.map(c=>c.ready)),Array(8).fill(true),'all writers must reach admission while lock is held');
    // No child may publish state while the parent transaction owns the write lock.
    assert.equal(lock.prepare('SELECT revision FROM actor WHERE id=1').get().revision,4);
    assert.equal(lock.prepare('SELECT COUNT(*) AS n FROM receipt').get().n,4);
    lock.exec('COMMIT');
    const results=await Promise.all(children.map(c=>c.done));
    for(const result of results){
      assert.equal(result.error,undefined);assert.equal(result.signal,null);
      assert.equal(result.status,0,result.stderr);
      assert.match(result.stdout,/^READY\n(?:COMMITTED|REPLAY) [5-8]\n$/);
    }
    const receipts=new Map();
    for(const result of results){
      const [,kind,revision]=result.stdout.match(/(COMMITTED|REPLAY) ([5-8])/);
      const pair=receipts.get(result.id)||[];
      pair.push({kind,revision:Number(revision),delta:result.delta});receipts.set(result.id,pair);
    }
    assert.equal(receipts.size,4);
    for(const pair of receipts.values()){
      assert.deepEqual(pair.map(x=>x.kind).sort(),['COMMITTED','REPLAY']);
      assert.equal(pair[0].revision,pair[1].revision);
    }
    const rows=snapshot();
    let balance=min+8n,enabled=true;
    const tail=rows.receipts.filter(r=>r.revision>4);
    assert.deepEqual(tail.map(r=>r.revision),[5,6,7,8]);
    for(const receipt of tail){
      const pair=receipts.get(receipt.id);assert.equal(pair[0].revision,receipt.revision);
      assert.equal(pair[0].delta,receipt.delta);
      balance+=BigInt(receipt.delta);enabled=!enabled;
      const event=rows.outbox.find(r=>r.revision===receipt.revision);
      assert.deepEqual(js.decode(event.checkpoint),[balance,enabled,balance]);
      assert.deepEqual(w.decode(event.checkpoint),[balance,enabled,balance]);
    }
    check(8,[min+18n,true,min+18n]);
  }finally{
    try{lock.exec('ROLLBACK');}catch{}lock.close();
    for(const c of children)if(c.child.exitCode===null&&c.child.signalCode===null)c.child.kill('SIGKILL');
    await Promise.all(children.map(c=>c.done));
  }
  console.log(JSON.stringify({kind:'JS_LLVM_WASM_SQLITE_PROCESS_REVIVAL_PASS',process_turns:22,physical_kills:2,commits:8,replays:7,rollback:1,atomic_rejections:6,concurrent_writers:8,concurrent_unique_messages:4,wasm_sha256:hash(wasmBytes),js_compiler_sha256:hash(readFileSync(jsPath)),js_guest_sha256:hash(generated.module_source),source_sha256:hash(source),production_broker:false}));
 }finally{rmSync(dir,{recursive:true,force:true});}
}
