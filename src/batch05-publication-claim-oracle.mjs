/** Source-free model only: dispatch claim does not write or authenticate IPC. */
export class PublicationClaimOracle {
  #pending=new Map(); #serial=0; #credits=0; #cap;
  constructor(capacity=64){
    if(!Number.isSafeInteger(capacity)||capacity<1||capacity>65536)
      throw new RangeError("capacity");
    this.#cap=capacity;
  }
  admit(session="local"){
    if(typeof session!=="string"||!/^[a-zA-Z0-9_-]{1,64}$/.test(session))
      throw Error("session");
    if(this.#pending.size>=this.#cap)return null;
    if(this.#serial===Number.MAX_SAFE_INTEGER)throw Error("overflow");
    const ticket=Object.freeze({id:++this.#serial});
    this.#pending.set(ticket,{session,state:"LOCAL_ADMITTED"});
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
  eof(session){
    const lost=[];
    for(const [ticket,e] of this.#pending){
      if(e.session===session)lost.push(Object.freeze({ticket,stage:e.state}));
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
