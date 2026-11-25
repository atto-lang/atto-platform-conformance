// Specification model only. This is NOT the Oreslang runtime implementation.
// Tests exercise lifecycle ordering and stale-owner rejection without a compiler.
export class ActorLockModel {
  constructor() {
    this.actors = new Map();
    this.locks = new Map();
    this.serial = 0;
    // Track retired generations as well as active ones: merely checking the
    // current actor table would permit older stale owners to resurrect.
    this.latestIncarnation = new Map();
  }
  key(id, incarnation) { return JSON.stringify([id, incarnation]); }
  spawn(id, incarnation) {
    if (typeof id !== "string" || !id || id.includes("\0")) throw Error("invalid actor identity");
    if (!Number.isSafeInteger(incarnation) || incarnation < 1) throw Error("invalid incarnation");
    const previous = this.latestIncarnation.get(id);
    if (previous !== undefined) {
      if (incarnation <= previous) throw Error("stale or replayed actor incarnation");
      if (this.actor(this.key(id, previous)).phase !== "retired")
        throw Error("previous incarnation has not physically retired");
    }
    const key = this.key(id, incarnation);
    if (this.actors.has(key)) throw Error("duplicate incarnation");
    this.actors.set(key, {phase:"live", tasks:new Map(), permits:new Set()});
    this.latestIncarnation.set(id, incarnation);
    return key;
  }
  task(actor, name) {
    const a = this.actor(actor);
    if (a.phase !== "live" || a.tasks.has(name)) throw Error("task admission fenced");
    a.tasks.set(name, "running");
  }
  actor(key) {
    const a = this.actors.get(key);
    if (!a) throw Error("unknown actor incarnation");
    return a;
  }
  lock(name) {
    if (!this.locks.has(name)) this.locks.set(name, {holders:[], queue:[], poisoned:false});
    return this.locks.get(name);
  }
  acquire(actor, task, name, mode="write", scope="task", authorizedTransfer=false) {
    const a=this.actor(actor), l=this.lock(name);
    if (a.phase!=="live" || a.tasks.get(task)!=="running") throw Error("admission fenced");
    if (mode!=="read" && mode!=="write") throw Error("invalid lock mode");
    if (scope!=="task" && scope!=="actor") throw Error("invalid scope");
    if (scope==="actor" && !authorizedTransfer) throw Error("actor ownership requires explicit authority");
    if ([...a.permits].some(p=>p.name===name && p.task===task && (p.status==="held" || p.status==="queued")))
      throw Error("recursive lock acquisition");
    const permit={nonce:++this.serial,actor,task,name,mode,scope,status:"queued"};
    a.permits.add(permit);
    // FIFO fairness: new readers may not overtake an already queued writer.
    if (l.queue.length===0 && this.canGrant(l,permit)) this.grant(l,permit);
    else l.queue.push(permit);
    return permit;
  }
  canGrant(l,p) {
    return !l.poisoned && (l.holders.length===0 ||
      (p.mode==="read" && l.holders.every(h=>h.mode==="read")));
  }
  grant(l,p) {
    if (p.status!=="queued" || !this.canGrant(l,p)) throw Error("invalid handoff");
    // Never deliver a permit to a fenced actor, cancelled Task or stale incarnation.
    const a=this.actor(p.actor);
    if (a.phase!=="live" || a.tasks.get(p.task)!=="running") {
      // Fencing can beat a queued-to-held handoff. Settle the losing ticket
      // in BOTH the queue and reverse owner index, exactly once.
      p.status="cancelled";
      a.permits.delete(p);
      return;
    }
    p.status="held";
    l.holders.push(p);
  }
  drain(l) {
    while (l.queue.length && this.canGrant(l,l.queue[0])) {
      const p=l.queue.shift();
      this.grant(l,p);
      if (p.status==="held" && p.mode==="write") return;
    }
  }
  cancelQueued(p) {
    if (p.status!=="queued") return false;
    const l=this.lock(p.name);
    const at=l.queue.indexOf(p);
    if (at!==-1) l.queue.splice(at,1);
    p.status="cancelled";
    this.actor(p.actor).permits.delete(p);
    this.drain(l);
    return true;
  }
  release(p, abnormalDirtyWriter=false) {
    if (p.status!=="held") return false;
    const l=this.lock(p.name);
    const index=l.holders.indexOf(p);
    if (index===-1) throw Error("stale holder reference");
    l.holders.splice(index,1);
    p.status="released";
    this.actor(p.actor).permits.delete(p);
    if (abnormalDirtyWriter && p.mode==="write") l.poisoned=true;
    this.drain(l);
    return true;
  }
  cancelTask(actor,task) {
    const a=this.actor(actor);
    if (a.tasks.get(task)==="quiesced") return;
    if (!a.tasks.has(task)) throw Error("unknown task");
    a.tasks.set(task,"stopping");
    // Pending requests can be revoked immediately. Held permits cannot.
    for (const p of [...a.permits]) if (p.task===task && p.status==="queued") this.cancelQueued(p);
  }
  quiesceTask(actor,task,dirty=false) {
    const a=this.actor(actor);
    if (a.tasks.get(task)==="quiesced") return;
    if (!a.tasks.has(task)) throw Error("unknown task");
    a.tasks.set(task,"quiesced");
    for (const p of [...a.permits]) {
      if (p.task===task && p.status==="queued") this.cancelQueued(p);
      if (p.task===task && p.scope==="task" && p.status==="held") this.release(p,dirty);
    }
    if (a.phase==="stopping" && [...a.tasks.values()].every(s=>s==="quiesced"))
      this.retireActor(actor,dirty);
  }
  stopActor(actor) {
    const a=this.actor(actor);
    if (a.phase==="retired") return;
    if (a.phase==="live") a.phase="stopping";
    for (const task of a.tasks.keys()) this.cancelTask(actor,task);
    if ([...a.tasks.values()].every(s=>s==="quiesced")) this.retireActor(actor);
  }
  retireActor(actor,dirty=false) {
    const a=this.actor(actor);
    if (a.phase==="retired") return;
    if (a.phase!=="stopping" || [...a.tasks.values()].some(s=>s!=="quiesced"))
      throw Error("cannot reclaim while guest execution is active");
    a.phase="retired";
    for (const p of [...a.permits]) {
      if (p.status==="queued") this.cancelQueued(p);
      if (p.status==="held") this.release(p,dirty);
    }
  }
  recover(name) {
    const l=this.lock(name);
    if (l.holders.length || !l.poisoned) throw Error("invalid recovery");
    // Represents successful exclusive repair, not simply clearing a flag.
    l.poisoned=false;
    this.drain(l);
  }
  assertConsistent() {
    // The per-owner reverse index must contain only physically outstanding
    // grants/requests, never settled tickets or a retired actor's permits.
    for (const [owner, a] of this.actors) {
      if (a.phase==="retired" && a.permits.size!==0)
        throw Error("retired actor retains permits");
      for (const p of a.permits) {
        if (p.actor!==owner) throw Error("wrong reverse-index owner");
        const l=this.locks.get(p.name);
        if (!l) throw Error("reverse-index lock missing");
        if (p.status==="held") {
          if (!l.holders.includes(p)) throw Error("orphan held permit");
        } else if (p.status==="queued") {
          if (!l.queue.includes(p)) throw Error("orphan queued permit");
          if (a.phase!=="live" || a.tasks.get(p.task)!=="running")
            throw Error("fenced task retains queued permit");
        } else throw Error("settled permit retained in reverse index");
      }
    }
    for (const l of this.locks.values()) {
      if (l.holders.length>1 && l.holders.some(p=>p.mode!=="read"))
        throw Error("overlapping writer");
      for (const p of l.holders) {
        if (p.status!=="held" || !this.actor(p.actor).permits.has(p))
          throw Error("untracked held permit");
      }
      for (const p of l.queue) {
        if (p.status!=="queued" || !this.actor(p.actor).permits.has(p))
          throw Error("untracked queued permit");
      }
      if (l.poisoned && l.holders.length) throw Error("poisoned lock granted");
    }
  }
}

// A fenced resource is authoritative only if it validates fencing tokens.
// The consensus/lease issuance protocol is deliberately NOT simulated here.
export class FencedResourceModel {
  constructor() { this.highest=0; this.value=null; }
  write(token,value) {
    if (!Number.isSafeInteger(token) || token<=0 || token<this.highest) return false;
    this.highest=token;
    this.value=value;
    return true;
  }
}
