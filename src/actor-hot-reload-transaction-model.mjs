/**
 * SOURCE-FREE REFERENCE MODEL. Never present this as tested Oreslang runtime.
 * Models logical authority/freeze/turn pins for SHARED same-schema actors.
 * Production needs compiler-inserted leases, authenticated image admission,
 * suspension/FFI/shared-region pin discovery, and one linearizable commit.
 */
export class ActorUpgradeModel {
  constructor() {
    this.actor='actor-1';this.heap='heap-1';this.mailbox='mailbox-1';
    this.lifecycle='running';this.ingress='open';
    this.authority=Object.freeze({route:1,code:1});
    this.revision=1;this.count=1;this.onStartRuns=1;
    this.queue=[];this.active=new Map();this.completed=new Set();
    this.accepted=new Set();this.outputs=[];this.candidate=null;
    this.retained=new Map([[1,0]]);this.retired=new Set();this.terminalEpoch=0;
  }
  invariant() {
    if(!['running','stopped'].includes(this.lifecycle))throw Error('bad lifecycle');
    if(!['open','frozen','sealed'].includes(this.ingress))throw Error('bad ingress');
    if(this.authority.route!==this.authority.code)throw Error('SPLIT AUTHORITY: route/code mismatch');
    if(this.authority.route!==this.revision)throw Error('route revision mismatch');
    if(this.onStartRuns!==1)throw Error('on_start repeated');
    if(this.outputs.some(o=>!this.completed.has(o.id)))throw Error('orphan reply');
    if(new Set(this.outputs.map(o=>o.id)).size!==this.outputs.length)throw Error('duplicate delivery');
    for(const [generation,pins] of this.retained){
      if(pins<0)throw Error('negative generation pins');
      if(this.retired.has(generation)&&pins>0)throw Error('unloaded code with active pins');
    }
    for(const [id,turn] of this.active){
      if(!this.accepted.has(id)||this.completed.has(id))throw Error('invalid in-flight turn');
      if(!this.retained.has(turn.generation)||this.retired.has(turn.generation))
        throw Error('unpinned executing image');
    }
    if(this.lifecycle==='stopped'&&this.ingress!=='sealed')throw Error('terminal reopened');
    return true;
  }
  send(id,delta){
    if(this.ingress!=='open'||this.lifecycle!=='running')return false;
    if(!Number.isSafeInteger(id)||!Number.isSafeInteger(delta)||this.accepted.has(id))return false;
    this.accepted.add(id);this.queue.push({id,delta});return true;
  }
  dispatch(){
    if(this.lifecycle!=='running'||this.queue.length===0)return false;
    const mail=this.queue.shift(),generation=this.authority.code;
    if(this.retired.has(generation))throw Error('new dispatch after retirement');
    this.active.set(mail.id,{...mail,generation});
    this.retained.set(generation,(this.retained.get(generation)??0)+1);return true;
  }
  complete(){
    if(!this.active.size)return false;
    const [id,turn]=this.active.entries().next().value;this.active.delete(id);
    const pins=this.retained.get(turn.generation);
    if(!pins||this.retired.has(turn.generation))throw Error('reclaimed executing image');
    this.retained.set(turn.generation,pins-1);
    if(turn.generation===1||turn.delta>=0)this.count+=turn.delta;
    else this.count-=turn.delta;
    this.completed.add(id);this.outputs.push({id,value:this.count,generation:turn.generation});
    return true;
  }
  freeze(){
    if(this.lifecycle!=='running'||this.ingress!=='open')return false;
    this.ingress='frozen';this.candidate=this.revision+1;return true;
  }
  publish(){
    if(this.lifecycle!=='running'||this.ingress!=='frozen'||
       this.candidate!==this.revision+1||this.queue.length||this.active.size||
       (this.retained.get(this.revision)??0)!==0)return false;
    const next=Object.freeze({route:this.revision+1,code:this.revision+1});
    // ONE linearization point; no observable code/route mismatch.
    this.retained.set(next.code,0);this.authority=next;this.revision=next.route;
    this.candidate=null;this.ingress='open';return true;
  }
  abort(){
    if(this.lifecycle!=='running'||this.ingress!=='frozen')return false;
    this.candidate=null;this.ingress='open';return true;
  }
  retire(){
    const old=this.revision-1;
    if(old<1||!this.retained.has(old)||(this.retained.get(old)??0)>0)return false;
    this.retired.add(old);return true;
  }
  stop(){
    if(this.lifecycle!=='running')return false;
    this.lifecycle='stopped';this.ingress='sealed';this.candidate=null;
    this.terminalEpoch++;return true;
  }
  step(command){
    switch(command){
      case 'send1':this.send(1,41);break;
      case 'send2':this.send(2,-1);break;
      case 'dispatch':this.dispatch();break;
      case 'complete':this.complete();break;
      case 'freeze':this.freeze();break;
      case 'publish':this.publish();break;
      case 'abort':this.abort();break;
      case 'retire':this.retire();break;
      case 'stop':this.stop();break;
      default:throw Error('unknown model operation');
    }
    return this.invariant();
  }
}
export function assertSplitPublicationRejected(){
  const s=new ActorUpgradeModel();s.freeze();
  // Unsafe native draft split: code CAS completed, scheduler route not yet.
  s.authority={route:1,code:2};
  return s.invariant();
}
