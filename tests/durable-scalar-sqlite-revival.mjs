// Reference process/disk interoperability, not the production broker or scheduler.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const source='define durable actor Ledger as state balance: int = -9223372036854775808; state open: bool = true; state last: int = 9223372036854775807; end';
const golden='4154544f5354303101f9b8eff04a5474590300010000000000000080020101ffffffffffffff7f4191e1156e4df645';
const hash=b=>createHash('sha256').update(b).digest('hex');
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
const w={initial(){assert.equal(e.atto_scalar_initial_v1(b,47n),47n);return m.slice(b,b+47);},encode(v){assert.equal(typeof v[1],'boolean');[v[0],v[1]?1n:0n,v[2]].forEach((x,i)=>d.setBigInt64(p+8*i,x,true));assert.equal(e.atto_scalar_encode_v1(p,3n,b,47n),47n);return m.slice(b,b+47);},decode(bytes){assert.equal(bytes.length,47);m.set(bytes,b);assert.equal(e.atto_scalar_decode_v1(b,47n,out,3n),3n);return [d.getBigInt64(out,true),d.getBigInt64(out+8,true)===1n,d.getBigInt64(out+16,true)];}};
assert.equal(Buffer.from(js.initial()).toString('hex'),golden);assert.deepEqual(w.initial(),js.initial());
function open(path){const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');return db;}
if(process.argv[2]==='--child'){
 const [, , ,path,mode,backend,id,deltaText]=process.argv;assert.ok(['precommit','postcommit','commit'].includes(mode));assert.ok(['js','wasm'].includes(backend));
 const codec=backend==='js'?js:w,delta=BigInt(deltaText),db=open(path);
 db.exec('BEGIN IMMEDIATE');
 try{
  const prior=db.prepare('SELECT delta,revision FROM receipt WHERE id=?').get(id);
  if(prior){assert.equal(prior.delta,deltaText);db.exec('COMMIT');console.log('REPLAY '+prior.revision);}
  else{
   const row=db.prepare('SELECT revision,checkpoint FROM actor WHERE id=1').get();
   const [balance,enabled]=codec.decode(row.checkpoint),next=balance+delta,revision=row.revision+1;
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
  console.log(JSON.stringify({kind:'JS_LLVM_WASM_SQLITE_PROCESS_REVIVAL_PASS',process_turns:6,physical_kills:2,commits:3,replays:2,rollback:1,wasm_sha256:hash(wasmBytes),js_compiler_sha256:hash(readFileSync(jsPath)),js_guest_sha256:hash(generated.module_source),source_sha256:hash(source),production_broker:false}));
 }finally{rmSync(dir,{recursive:true,force:true});}
}
