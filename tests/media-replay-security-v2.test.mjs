import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ReplayWindow } from '../lib/media-replay-v1.mjs';
import { ReceiverLedger } from '../lib/media-replay-receiver-v1.mjs';
const id={streamId:'secure-media',generation:1};
const packed=(bytes)=>{const b=Uint8Array.from(bytes);return{bytes:b,sha256:createHash('sha256').update(b).digest('hex')}};
const pkt=(n,config='av1-main',ptsUs=0)=>({...id,sequence:n,offset:n,endOffset:n+1,randomAccess:n===0||n===2,codecConfigId:config,ptsUs,...packed([n+8])});
const chunk=(n,config='av1-main')=>({sequence:n,offset:n,codecConfigId:config,randomAccess:n===0||n===2,bytes:Uint8Array.from([n+8])});
const code=(value,x)=>assert.deepEqual(value,{ok:false,error:{code:x}});

test('cannot silently replay across codec reconfiguration',()=>{
 const s=new ReplayWindow({...id,capacityBytes:8});
 assert.equal(s.append(chunk(0)).ok,true);
 assert.equal(s.append(chunk(1)).ok,true);
 assert.equal(s.append(chunk(2,'av1-next')).ok,true);
 assert.equal(s.append(chunk(3,'av1-next')).ok,true);
 code(s.resume({...id,lastAppliedSequence:-1,lastAppliedEndOffset:0,codecConfigId:'av1-main'}),'CODEC_CONFIG_TRANSITION');
 assert.equal(s.status.usedBytes,4);
});

test('receiver reset cannot commit random access from another codec',()=>{
 const r=new ReceiverLedger(id);
 assert.equal(r.commit(pkt(0)).ok,true);
 assert.equal(r.resetAt({...id,restartSequence:2,restartOffset:2,codecConfigId:'av1-next'}).ok,true);
 code(r.commit(pkt(2,'av1-foreign')),'RESET_CODEC_MISMATCH');
 assert.equal(r.checkpoint.lastAppliedSequence,0);
 assert.equal(r.checkpoint.resetPending,true);
 assert.equal(r.commit(pkt(2,'av1-next')).ok,true);
 assert.equal(r.checkpoint.discontinuity.skippedThroughSequence,1);
});

test('duplicate sequence with changed timestamp must fail closed',()=>{
 const r=new ReceiverLedger(id);
 assert.equal(r.commit(pkt(0,'av1-main',100)).ok,true);
 code(r.offer(pkt(0,'av1-main',200)),'DUPLICATE_CONFLICT');
 assert.equal(r.offer(pkt(0,'av1-main',100)).value.mode,'duplicate');
});

test('invalid timestamps are refused without changing applied state',()=>{
 const r=new ReceiverLedger(id);
 code(r.commit({...pkt(0),ptsUs:-1}),'INVALID_CHUNK');
 code(r.commit({...pkt(0),ptsUs:1.5}),'INVALID_CHUNK');
 assert.equal(r.checkpoint.lastAppliedSequence,-1);
});
