// Pure wire-format conformance only: NOT a Java/C++/AttoLang guest test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const spec=JSON.parse(readFileSync(
  new URL('../../contracts/event-sourcing-durable-command-v1.json',import.meta.url),'utf8'));
const encode=events=>{
  assert.ok(events.length>0 && events.length<=spec.maxEventsPerCommand);
  const parts=[Buffer.alloc(4)];parts[0].writeUInt32BE(events.length);
  let total=4;
  for(const item of events){
    const value=Buffer.from(item.payload,'utf8');
    assert.ok(item.schema>0&&Number.isSafeInteger(item.schema));
    assert.ok(value.length<=spec.maxSingleEventBytes);
    total+=8+value.length;
    assert.ok(total<=spec.maxBatchBytes);
    const header=Buffer.alloc(8);
    header.writeUInt32BE(item.schema,0);
    header.writeUInt32BE(value.length,4);
    parts.push(header,value);
  }
  return Buffer.concat(parts);
};
const decode=input=>{
  if(input.length<12||input.length>spec.maxBatchBytes)throw Error('INVALID_BATCH');
  const count=input.readUInt32BE(0);
  if(count<1||count>spec.maxEventsPerCommand)throw Error('INVALID_BATCH');
  let pos=4;
  const events=[];
  for(let i=0;i<count;i++){
    if(pos+8>input.length)throw Error('INVALID_BATCH');
    const schema=input.readUInt32BE(pos),size=input.readUInt32BE(pos+4);
    if(!schema||size>spec.maxSingleEventBytes||pos+8+size>input.length)
      throw Error('INVALID_BATCH');
    events.push({schema,payload:input.subarray(pos+8,pos+8+size).toString('utf8')});
    pos+=8+size;
  }
  if(pos!==input.length)throw Error('INVALID_BATCH');
  return events;
};
test('canonical two-event command wire is stable and roundtrips',()=>{
  const ex=spec.wire.example;
  const bytes=encode(ex.events);
  assert.equal(bytes.toString('hex'),ex.event_batch_hex);
  assert.deepEqual(decode(bytes),ex.events);
  assert.deepEqual([ex.first_version,ex.last_version],[1,2]);
});
test('truncation, trailing bytes, bad count and schema fail closed',()=>{
  const bytes=Buffer.from(spec.wire.example.event_batch_hex,'hex');
  for(const length of [0,1,4,11,bytes.length-1])
    assert.throws(()=>decode(bytes.subarray(0,length)),/INVALID_BATCH/);
  assert.throws(()=>decode(Buffer.concat([bytes,Buffer.from([0])])),/INVALID_BATCH/);
  for(const change of [[0,0],[0,255],[4,0]]){
    const changed=Buffer.from(bytes);
    changed.writeUInt32BE(change[1],change[0]);
    assert.throws(()=>decode(changed),/INVALID_BATCH/);
  }
});
test('guest proof claims remain NOT_EXECUTED for five backends',()=>{
  assert.equal(spec.status,'DRAFT');
  assert.deepEqual(Object.keys(spec.statusByBackend),['java','llvm','net','wasm','forge']);
  assert.ok(Object.values(spec.statusByBackend).every(x=>x==='NOT_EXECUTED'));
  assert.ok(spec.requiredNegatives.includes('rollback_on_second_event_failure'));
  assert.ok(spec.requiredNegatives.includes('same_operation_changed_command'));
});
