// A deliberately SOURCE-FREE oracle. This is NOT an Atto compiler or guest VM.
export class ActorReadyPipeOracle {
  constructor() { this.actors = new Map(); this.links = []; this.nextId = 1; }
  spawn({tenant='t1',receives=null,emits=null}={}) {
    const a = {id:this.nextId++, tenant,receives,emits, state:'STARTING',ready:null,done:null,loans:0,stopped:false};
    this.actors.set(a.id,a); return a;
  }
  live(a) { return !!a && this.actors.get(a.id) === a && a.state !== 'DONE'; }
  get_ready(a) { return this.live(a) || (a && this.actors.get(a.id)===a) ? a.ready : {ok:false,error:'STALE'}; }
  get_done(a) { return this.live(a) || (a && this.actors.get(a.id)===a) ? a.done : {ok:false,error:'STALE'}; }
  connect(source,sink,{capacity=2}={}) {
    // First validate every participant; no publication or credit acquisition until all checks succeed.
    if (!this.live(source) || !this.live(sink)) return {ok:false,error:'STALE'};
    if (source.stopped || sink.stopped) return {ok:false,error:'STOPPED'};
    if (source.tenant !== sink.tenant) return {ok:false,error:'TENANT_DENIED'};
    if (!source.emits || source.emits !== sink.receives) return {ok:false,error:'TYPE'};
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4096) return {ok:false,error:'CAPACITY'};
    if (this.links.some(l => l.source === source && l.sink === sink)) return {ok:false,error:'DUPLICATE_EDGE'};
    if (this.links.some(l => l.source === source || l.sink === sink)) return {ok:false,error:'PORT_OCCUPIED'};
    const link={source,sink,capacity,queue:[],delivered:[],done:null};
    this.links.push(link);
    return {ok:true,link};
  }
  ready(a) {
    if (!this.live(a) || a.state !== 'STARTING' || a.stopped) return {ok:false,error:'NOT_STARTING'};
    a.state='READY'; a.ready={ok:true};
    for(const l of this.links) this.flush(l);
    return a.ready;
  }
  emit(link,value) {
    if (!link || !this.links.includes(link) || link.done || !this.live(link.source)) return {ok:false,error:'CLOSED'};
    if (link.source.state !== 'READY' || link.source.stopped) return {ok:false,error:'STOPPED_OR_NOT_READY'};
    if (link.queue.length >= link.capacity) return {ok:false,error:'BACKPRESSURE'};
    link.queue.push(value); this.flush(link); return {ok:true};
  }
  flush(link) {
    if (link.done) return;
    if (link.sink.state === 'READY' && !link.sink.stopped) {
      while(link.queue.length) link.delivered.push(link.queue.shift());
    }
    if(link.source.stopped && link.queue.length===0) link.done={ok:true,delivered:link.delivered.length};
  }
  fail_start(a,reason='STARTUP_ERROR') {
    if(!this.live(a) || a.state !== 'STARTING') return {ok:false,error:'NOT_STARTING'};
    a.ready={ok:false,error:reason}; a.stopped=true; a.state='FAILED';
    for (const l of this.links) if(l.source===a || l.sink===a) { l.queue=[]; if(!l.done) l.done={ok:false,error:reason}; }
    return a.ready;
  }
  stop(a) {
    if (!this.live(a)) return {ok:false,error:'STALE'};
    if(a.stopped) return {ok:true,already:true};
    if(a.state === 'STARTING') a.ready={ok:false,error:'STOPPED_BEFORE_READY'};
    a.stopped=true;
    if(a.state !== 'FAILED') a.state='DRAINING';
    for(const l of this.links) if(l.source===a) this.flush(l);
    return {ok:true};
  }
  retire(a) {
    if (!this.live(a) || !a.stopped) return {ok:false,error:'NOT_STOPPED'};
    if (a.loans !== 0) return {ok:false,error:'PINNED_LOANS'};
    if (this.links.some(l => l.source === a && !l.done)) return {ok:false,error:'PENDING_PIPE'};
    if (a.state === 'FAILED' || (a.ready && !a.ready.ok)) a.done={ok:false,error:a.ready?.error||'FAILED'};
    else a.done={ok:true};
    a.state='DONE';
    return a.done;
  }
}
