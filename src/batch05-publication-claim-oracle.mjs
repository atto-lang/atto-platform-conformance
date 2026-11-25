/** Source-free model only: dispatch claim does not write or authenticate IPC. */
const EPOCH_FIELDS=["domain","sender","destination","session",
  "senderIncarnation","destinationIncarnation","routeEpoch","capabilityGeneration"];
const DEFAULT_EPOCH=Object.freeze({domain:"tenant",sender:"sender",
  destination:"worker",session:"local",senderIncarnation:1,
  destinationIncarnation:2,routeEpoch:3,capabilityGeneration:4});
function epochKey(epoch){
  if(!epoch||typeof epoch!=="object"||Array.isArray(epoch)||
      Object.keys(epoch).sort().join("|")!==[...EPOCH_FIELDS].sort().join("|"))
    throw Error("complete transport epoch required");
  for(const k of EPOCH_FIELDS.slice(0,4))
    if(typeof epoch[k]!=="string"||!/^[A-Za-z0-9_.-]{1,64}$/.test(epoch[k]))
      throw Error("invalid epoch token");
  for(const k of EPOCH_FIELDS.slice(4))
    if(!Number.isSafeInteger(epoch[k])||epoch[k]<=0)throw Error("invalid epoch generation");
  return Object.freeze({...epoch});
}
function sameEpoch(a,b){
  return EPOCH_FIELDS.every(k=>a[k]===b[k]);
}
export class PublicationClaimOracle {
  #pending=new Map(); #serial=0; #credits=0; #cap;
  constructor(capacity=64){
    if(!Number.isSafeInteger(capacity)||capacity<1||capacity>65536)
      throw new RangeError("capacity");
    this.#cap=capacity;
  }
  admit(epoch=DEFAULT_EPOCH){
    const trustedEpoch=epochKey(epoch);
    if(this.#pending.size>=this.#cap)return null;
    if(this.#serial===Number.MAX_SAFE_INTEGER)throw Error("overflow");
    const ticket=Object.freeze({id:++this.#serial});
    this.#pending.set(ticket,{epoch:trustedEpoch,state:"LOCAL_ADMITTED"});
    this.#credits++;return ticket;
  }
  #get(t){const e=this.#pending.get(t);if(!e)throw Error("stale");return e;}
  claim(t){
    const e=this.#get(t);
    if(e.state!=="LOCAL_ADMITTED")throw Error("duplicate claim");
    e.state="DISPATCH_CLAIMED";
  }
  reject(t){
    const e=this.#get(t);
    if(e.state!=="LOCAL_ADMITTED")throw Error("never-sent not proven");
    this.#pending.delete(t);this.#credits--;
    return "REJECTED_BEFORE_REMOTE";
  }
  receipt(t,stage){
    if(stage==="OUTCOME_UNKNOWN"||stage==="REJECTED_BEFORE_REMOTE")
      throw Error("remote cannot assert local verdict");
    const e=this.#get(t);
    if(e.state==="DISPATCH_CLAIMED"&&stage==="REMOTE_ACCEPTED"){
      e.state="REMOTE_ACCEPTED";this.#credits--;return null;
    }
    if(e.state==="REMOTE_ACCEPTED"&&
      (stage==="HANDLER_COMMITTED"||stage==="HANDLER_FAILED")){
      this.#pending.delete(t);return stage;
    }
    throw Error("out of order");
  }
  eof(epoch){
    const trustedEpoch=epochKey(epoch);
    const lost=[];
    for(const [ticket,e] of this.#pending){
      if(sameEpoch(e.epoch,trustedEpoch))
        lost.push(Object.freeze({ticket,stage:e.state}));
    }
    for(const {ticket} of lost){
      const e=this.#pending.get(ticket);this.#pending.delete(ticket);
      if(e.state!=="REMOTE_ACCEPTED")this.#credits--;
    }
    return Object.freeze(lost);
  }
  state(t){return this.#pending.get(t)?.state??"RETIRED";}
  counts(){return Object.freeze({pending:this.#pending.size,credits:this.#credits});}
  invariant(){
    return this.#credits>=0&&this.#credits<=this.#cap&&
      this.#credits===[...this.#pending.values()]
      .filter(e=>e.state==="LOCAL_ADMITTED"||e.state==="DISPATCH_CLAIMED").length;
  }
}
