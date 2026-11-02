import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ReplayWindow } from '../lib/media-replay-v1.mjs';
import { ReceiverLedger } from '../lib/media-replay-receiver-v1.mjs';

const launch = (command, args) => spawnSync(command, args, { encoding: 'utf8', timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
const canEncode = () => {
  const a=launch('ffmpeg',['-hide_banner','-encoders']);
  const b=launch('ffprobe',['-version']);
  return !a.error && a.status === 0 && a.stdout.includes('libx264') && !b.error && b.status === 0;
};
function splitAnnexBAccessUnits(bytes) {
  const starts=[];
  for(let i=0;i<bytes.length-4;i++){
    const size=bytes[i]===0 && bytes[i+1]===0 && bytes[i+2]===1 ? 3 :
      bytes[i]===0 && bytes[i+1]===0 && bytes[i+2]===0 && bytes[i+3]===1 ? 4 : 0;
    if(!size)continue;
    starts.push({at:i,type:bytes[i+size]&31});
    i+=size-1;
  }
  const units=[];
  const positions=starts.filter(n=>n.type===9).map(n=>n.at);
  for(let i=0;i<positions.length;i++){
    const start=positions[i],end=positions[i+1]??bytes.length;
    const nalTypes=starts.filter(n=>n.at>=start&&n.at<end).map(n=>n.type);
    units.push({bytes:bytes.subarray(start,end),randomAccess:nalTypes.includes(5)&&nalTypes.includes(7)&&nalTypes.includes(8)});
  }
  return units;
}
function countDecodedFrames(file) {
  const r=launch('ffprobe',['-v','error','-f','h264','-count_frames','-show_entries','stream=nb_read_frames','-of','csv=p=0',file]);
  assert.equal(r.status,0,'ffprobe: '+r.stderr);
  return Number(r.stdout.trim());
}

test('real FFmpeg H264 x264/Annex-B replay, reconnect, decoder reset from IDR',
  { skip: !canEncode() ? 'explicit UNSUPPORTED: FFmpeg libx264 and ffprobe required' : false }, () => {
  const dir=mkdtempSync(join(tmpdir(),'ores-media-replay-'));
  try {
    const originalFile=join(dir,'source.h264'), recovered=join(dir,'replayed.h264'), restart=join(dir,'restart.h264');
    const encode=launch('ffmpeg',['-hide_banner','-v','error','-f','lavfi','-i','testsrc2=size=64x64:rate=10',
      '-frames:v','30','-c:v','libx264','-pix_fmt','yuv420p',
      '-x264-params','keyint=10:min-keyint=10:scenecut=0:aud=1:repeat-headers=1:bframes=0',
      '-f','h264','-y',originalFile]);
    assert.equal(encode.status,0,'ffmpeg encoder: '+encode.stderr);
    const original=readFileSync(originalFile),units=splitAnnexBAccessUnits(original);
    assert.equal(units.length,30);
    assert.deepEqual(units.map((v,i)=>v.randomAccess?i:null).filter(v=>v!==null),[0,10,20]);
    const ident={streamId:'ffmpeg-h264-stream',generation:1};
    const sender=new ReplayWindow({...ident,capacityBytes:2*1024*1024});
    const receiver=new ReceiverLedger(ident);
    let offset=0;
    for(let i=0;i<units.length;i++){
      const chunk=units[i];
      const result=sender.append({sequence:i,offset,bytes:chunk.bytes,codecConfigId:'h264-x264-v1',
        randomAccess:chunk.randomAccess,ptsUs:i*100_000});
      assert.equal(result.ok,true);
      offset+=chunk.bytes.length;
    }
    assert.ok(sender.status.usedBytes<2*1024*1024);
    assert.equal(countDecodedFrames(originalFile),30);
    const initial=sender.resume({...ident,lastAppliedSequence:-1,lastAppliedEndOffset:0,codecConfigId:'h264-x264-v1'});
    assert.equal(initial.value.mode,'replay');
    const received=[];
    for(const chunk of initial.value.chunks.slice(0,10)){
      assert.equal(receiver.commit({...ident,...chunk}).ok,true);
      received.push(chunk.bytes);
    }
    const checkpoint=receiver.checkpoint;
    assert.equal(sender.acknowledge({...ident,sequence:checkpoint.lastAppliedSequence,endOffset:checkpoint.lastAppliedEndOffset}).ok,true);
    const afterDisconnect=sender.resume({...ident,...checkpoint});
    assert.equal(afterDisconnect.value.mode,'replay');
    for(const chunk of afterDisconnect.value.chunks){
      assert.equal(receiver.commit({...ident,...chunk}).ok,true);
      received.push(chunk.bytes);
    }
    assert.equal(receiver.checkpoint.lastAppliedSequence,29);
    const replayed=Buffer.concat(received);
    assert.deepEqual(replayed,original);
    writeFileSync(recovered,replayed);
    assert.equal(countDecodedFrames(recovered),30);

    // The independently decodable frame at index 20 carries SPS/PPS and IDR.
    const anchor=initial.value.chunks[20];
    assert.equal(anchor.randomAccess,true);
    const nextReceiver=new ReceiverLedger(ident);
    for(const chunk of initial.value.chunks.slice(0,10)) assert.equal(nextReceiver.commit({...ident,...chunk}).ok,true);
    assert.equal(nextReceiver.resetAt({...ident,restartSequence:20,restartOffset:anchor.offset,codecConfigId:'h264-x264-v1'}).ok,true);
    assert.equal(nextReceiver.checkpoint.lastAppliedSequence,9);
    assert.deepEqual(nextReceiver.commit({...ident,...initial.value.chunks[11]}),{ok:false,error:{code:'DUPLICATE_EXPIRED'}});
    const decodedRestart=[];
    for(const chunk of initial.value.chunks.slice(20)){
      assert.equal(nextReceiver.commit({...ident,...chunk}).ok,true);
      decodedRestart.push(chunk.bytes);
    }
    assert.equal(nextReceiver.checkpoint.discontinuity.skippedFromSequence,10);
    assert.equal(nextReceiver.checkpoint.discontinuity.skippedThroughSequence,19);
    writeFileSync(restart,Buffer.concat(decodedRestart));
    assert.equal(countDecodedFrames(restart),10);
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
});
