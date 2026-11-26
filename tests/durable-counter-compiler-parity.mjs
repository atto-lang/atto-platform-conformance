// Executed guest parity, not a full runtime or disk guarantee.
// Usage: node tests/durable-counter-compiler-parity.mjs /path/to/attoc /path/to/source-js/src/transpile-worker.mjs
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const [cli,jsPath]=process.argv.slice(2);
assert.ok(cli&&jsPath&&process.argv.length===4,'two explicit compiler paths required');
const fixture=fileURLToPath(new URL('../fixtures/actors/persistence/durable_counter_broker_v1.atto',import.meta.url));
const source=readFileSync(fixture);
const dir=mkdtempSync(join(tmpdir(),'atto-durable-parity-'));
const hash=b=>createHash('sha256').update(b).digest('hex');
try{
  const artifact=join(dir,'counter.wasm');
  const r=spawnSync(resolve(cli),['--durable-counter-actor-v1',fixture,'-o',artifact],
    {encoding:'utf8',timeout:30000,maxBuffer:1<<20});
  assert.equal(r.error,undefined);assert.equal(r.status,0,r.stderr);
  const binary=readFileSync(artifact);
  const mod=new WebAssembly.Module(binary);
  assert.deepEqual(WebAssembly.Module.imports(mod),[]);
  const w=new WebAssembly.Instance(mod,{}).exports;
  const {compile_durable_counter_actor_v1}=await import(pathToFileURL(resolve(jsPath)));
  const generated=compile_durable_counter_actor_v1(source.toString('utf8'));
  assert.equal(generated.guest_abi,'atto.js.durable.counter.v1');
  const js=await import('data:text/javascript;base64,'+Buffer.from(generated.module_source).toString('base64'));
  const sections=WebAssembly.Module.customSections(mod,'atto.durable.state.v1');
  assert.equal(sections.length,1);
  const descriptor=Buffer.from(sections[0]);
  assert.deepEqual(descriptor,Buffer.from(js.atto_durable_state_v1()));
  // Independently verify the descriptor rather than treating equality of two
  // backend bugs as correctness. The one int Counter.count schema is fixed.
  assert.equal(descriptor[0],1);
  assert.equal(descriptor[1],7);
  assert.equal(descriptor.subarray(2,9).toString(),'Counter');
  assert.equal(descriptor[9],5);
  assert.equal(descriptor.subarray(10,15).toString(),'count');
  assert.equal(descriptor[15],1);
  assert.equal(descriptor[16],36);
  const snapshot=descriptor.subarray(17);
  assert.equal(snapshot.length,36);
  assert.equal(snapshot.subarray(0,8).toString(),'ATTOST01');
  assert.equal(snapshot[8],1);
  assert.equal(snapshot.readBigUInt64LE(9),0x46ec970556cc8237n);
  assert.equal(snapshot.readUInt16LE(17),1);assert.equal(snapshot[19],1);
  assert.equal(snapshot.readBigInt64LE(20),0n);
  let h=0xcbf29ce484222325n;
  for(const b of snapshot.subarray(0,28))h=BigInt.asUintN(64,(h^BigInt(b))*0x100000001b3n);
  assert.equal(snapshot.readBigUInt64LE(28),h);
  const oracle=(s,op,d)=>{
    if(s<0n||s>1000000000n)return -1n;
    if(op===2n)return d===0n?s:-1n;
    if(op!==1n||d<=0n||d>1000000000n||s+d>1000000000n)return -1n;
    return s+d;
  };
  let cases=0;
  function compare(s,op,d){
    const expected=oracle(s,op,d);
    assert.equal(w.atto_durable_transition_v1(s,op,d),expected);
    assert.equal(js.atto_durable_transition_v1(s,op,d),expected);
    cases++;return expected;
  }
  let s=0n;
  for(let i=0;i<100;i++)s=compare(s,1n,1n);
  assert.equal(s,100n);
  for(const state of [-1n,0n,100n,999999999n,1000000000n,1000000001n])
    for(const op of [0n,1n,2n,3n])
      for(const delta of [-1n,0n,1n,42n,1000000000n,1000000001n])
        compare(state,op,delta);
  assert.equal(cases,244);
  // Preserve the original 244-vector contract. Exercise signed i64 endpoints
  // separately so an overflow or truncation in an ABI adapter cannot pass
  // simply because all of the original inputs are relatively small.
  const min=-(1n<<63n),max=(1n<<63n)-1n;
  const extremes=[
    [min,1n,1n],[max,1n,1n],[0n,min,0n],[0n,max,0n],
    [0n,1n,min],[0n,1n,max],[1000000000n,1n,max],
    [0n,2n,min],[0n,2n,max],[999999999n,1n,1n],
    [1000000000n,2n,0n],[1000000000n,1n,1n]
  ];
  for(const [state,op,delta] of extremes)compare(state,op,delta);
  assert.equal(cases,244+extremes.length);
  assert.equal(w.panic_code.value,0);
  // Stateful differential replay: interleave valid turns, malformed requests,
  // boundary saturation and retries. An invalid turn must not become the
  // committed state; a subsequent read must still see the prior accepted
  // value. This is an in-memory transition test, not a persistence claim.
  const replayStats={accepted:0,rejected:0,reads:0};
  for(const initial of [0n,1n,999999999n,1000000000n]){
    let expectedState=initial,wasmState=initial,jsState=initial;
    let seed=0x12345678n ^ initial;
    for(let i=0;i<128;i++){
      seed=(1664525n*seed+1013904223n)&0xffffffffn;
      const room=1000000000n-expectedState;
      const choices=[
        [1n,room>0n?1n+seed%room:1n],
        [1n,0n],[1n,-1n],[1n,room+1n],[2n,0n],
        [2n,1n],[3n,0n],[1n,max]
      ];
      const [op,delta]=choices[i%choices.length];
      const expected=oracle(expectedState,op,delta);
      const wr=w.atto_durable_transition_v1(wasmState,op,delta);
      assert.equal(w.panic_code.value,0,`replay wasm panic initial=${initial} step=${i}`);
      const jr=js.atto_durable_transition_v1(jsState,op,delta);
      assert.equal(wr,expected,`replay wasm initial=${initial} step=${i}`);
      assert.equal(jr,expected,`replay js initial=${initial} step=${i}`);
      if(expected!==-1n){
        expectedState=expected;
        replayStats.accepted++;
      }else replayStats.rejected++;
      if(wr!==-1n)wasmState=wr;
      if(jr!==-1n)jsState=jr;
      assert.equal(wasmState,expectedState);
      assert.equal(jsState,expectedState);
      assert.equal(w.atto_durable_transition_v1(wasmState,2n,0n),expectedState);
      assert.equal(w.panic_code.value,0);
      assert.equal(js.atto_durable_transition_v1(jsState,2n,0n),expectedState);
      replayStats.reads++;
    }
  }
  assert.equal(replayStats.accepted+replayStats.rejected,512);
  assert.equal(replayStats.reads,512);
  assert.ok(replayStats.accepted>0&&replayStats.rejected>0);
  // Exercise the actual compiler denial path with identical source bytes.
  // A crash, timeout, missing diagnostic, or published artifact is not denial.
  const text=source.toString('utf8');
  const mutations=[
    ['volatile',text.replace('durable actor','actor')],
    ['wrong-initial-state',text.replace('= 0;','= 1;')],
    ['wrong-operation',text.replace('self.count + mail.value','self.count - mail.value')],
    ['wrong-mail-type',text.replace('ActorMail<int>','ActorMail<bool>')],
    ['wrong-field',text.replace('self.count =','self.unknown =')],
    ['extra-statement',text.replace('self.count = self.count + mail.value;',
        'self.count = self.count + mail.value; self.count = 0;')],
    ['trailing-declaration',text+'\npub fnc main()->int {return 0;}']
  ];
  for(const [id,invalid] of mutations){
    assert.notEqual(invalid,text,id);
    const input=join(dir,id+'.atto'),output=join(dir,id+'.wasm');
    writeFileSync(input,invalid);
    const bad=spawnSync(resolve(cli),['--durable-counter-actor-v1',input,'-o',output],
        {encoding:'utf8',timeout:30000,maxBuffer:1<<20});
    assert.equal(bad.error,undefined,id);
    assert.equal(bad.status,1,id+': '+bad.stderr);
    assert.match(bad.stderr,/E_DURABLE_COUNTER_ACTOR_ABI/,id);
    assert.equal(existsSync(output),false,id);
    assert.throws(()=>compile_durable_counter_actor_v1(invalid),/E_DURABLE_COUNTER_ACTOR_ABI/,id);
  }
  // The common native subset supports count/balance and mail/event.
  // Bind schema identity to the state field, never the handler parameter.
  function expectedDescriptor(field) {
    const actor=Buffer.from('Counter'),name=Buffer.from(field);
    const sized=b=>{
      const length=Buffer.alloc(4);length.writeUInt32LE(b.length);
      return Buffer.concat([length,b]);
    };
    const fnv=bytes=>{
      let acc=0xcbf29ce484222325n;
      for(const b of bytes)acc=BigInt.asUintN(64,(acc^BigInt(b))*0x100000001b3n);
      return acc;
    };
    const initial=Buffer.alloc(36);
    initial.write('ATTOST01',0,'ascii');initial[8]=1;
    initial.writeBigUInt64LE(fnv(Buffer.concat([
      Buffer.from('atto.actor.state.schema.v1'),Buffer.from([0]),
      sized(actor),sized(name),Buffer.from([1])
    ])),9);
    initial.writeUInt16LE(1,17);initial[19]=1;
    initial.writeBigUInt64LE(fnv(initial.subarray(0,28)),28);
    return Buffer.concat([Buffer.from([1,actor.length]),actor,
      Buffer.from([name.length]),name,Buffer.from([1,initial.length]),initial]);
  }
  assert.deepEqual(descriptor,expectedDescriptor('count'));
  const renameCases=[['balance','mail'],['count','event'],['balance','event']];
  for(const [field,mail] of renameCases){
    const id=field+'-'+mail;
    const variant=text.replaceAll('count',field).replaceAll('mail',mail);
    const input=join(dir,id+'.atto'),output=join(dir,id+'.wasm');
    writeFileSync(input,variant);
    const built=spawnSync(resolve(cli),['--durable-counter-actor-v1',input,'-o',output],
      {encoding:'utf8',timeout:30000,maxBuffer:1<<20});
    assert.equal(built.error,undefined,id);
    assert.equal(built.status,0,id+': '+built.stderr);
    const vm=new WebAssembly.Module(readFileSync(output));
    assert.deepEqual(WebAssembly.Module.imports(vm),[],id);
    const vg=new WebAssembly.Instance(vm,{}).exports;
    const cg=compile_durable_counter_actor_v1(variant);
    assert.equal(cg.guest_abi,'atto.js.durable.counter.v1',id);
    const jg=await import('data:text/javascript;base64,'+Buffer.from(cg.module_source).toString('base64'));
    const metadata=WebAssembly.Module.customSections(vm,'atto.durable.state.v1');
    assert.equal(metadata.length,1,id);
    const expected=expectedDescriptor(field);
    assert.deepEqual(Buffer.from(metadata[0]),expected,id);
    assert.deepEqual(Buffer.from(jg.atto_durable_state_v1()),expected,id);
    if(field==='count')assert.deepEqual(expected,descriptor,id);
    else assert.notDeepEqual(expected,descriptor,id);
    for(const [state,op,delta] of [[0n,1n,42n],[42n,2n,0n],[1000000000n,1n,1n],[0n,1n,min]]){
      const result=oracle(state,op,delta);
      assert.equal(vg.atto_durable_transition_v1(state,op,delta),result,id);
      assert.equal(jg.atto_durable_transition_v1(state,op,delta),result,id);
    }
    assert.equal(vg.panic_code.value,0,id);
  }
  console.log(JSON.stringify({status:'RESTRICTED_COMPILED_GUEST_PARITY',cases:244,extendedSignedI64Cases:extremes.length,compilerDenials:mutations.length,renamedSchemaVariants:renameCases.length,renamedTransitionCases:renameCases.length*4,replayStats,sourceSha256:hash(source),
    wasmSha256:hash(binary),jsSha256:hash(generated.module_source),descriptorSha256:hash(descriptor),
    fullDurableActorParity:false,diskRecoveryExecuted:false}));
}finally{rmSync(dir,{recursive:true,force:true});}
