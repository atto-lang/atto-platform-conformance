/**
 * Executable bounded HTTP actor admission and shutdown reference model.
 * No claim of AttoLang compiler/guest execution, scheduling fairness or CI provenance.
 * Single physical guest turn per actor incarnation even when many request/message
 * lifetimes are admitted. Token object identity is the source-free capability oracle.
 */
export class HttpActorAdmissionModel {
  constructor({request_concurrency=1,message_concurrency=1}={}) {
    for (const [name,n] of Object.entries({request_concurrency,message_concurrency})) {
      if (!Number.isSafeInteger(n) || n<1 || n>64) throw new RangeError(`${name} must be 1..64`);
    }
    this.request_concurrency=request_concurrency;
    this.message_concurrency=message_concurrency;
    this.generation=1;
    this.next_request=1;
    this.next_message=1;
    this.sealed=false;
    this.requests=new Map();
    this.messages=new Map();
    this.physical=null;
  }
  _request(token) {
    const value=token && this.requests.get(token.id);
    if (!token || token.kind!=="http-request" || token.generation!==this.generation ||
        !value || value.token!==token)
      throw new Error("stale or forged request capability");
    return value;
  }
  _message(token) {
    const value=token && this.messages.get(token.id);
    if (!token || token.kind!=="http-message" || token.generation!==this.generation ||
        !value || value.token!==token)
      throw new Error("stale or forged message capability");
    return value;
  }
  admit_request(key) {
    if(this.sealed) throw new Error("request admission sealed");
    if (typeof key!=="string" || key.length<1 || key.length>128) throw new TypeError("invalid request key");
    if(this.requests.size>=this.request_concurrency) throw new Error("request capacity exhausted");
    if([...this.requests.values()].some(r=>r.key===key)) throw new Error("duplicate request");
    const token=Object.freeze({kind:"http-request",id:this.next_request++,generation:this.generation});
    this.requests.set(token.id,{token,key,response_closed:false,active:new Set()});
    return token;
  }
  admit_message(request_token,key) {
    if(this.sealed) throw new Error("message admission sealed");
    const request=this._request(request_token);
    if(request.response_closed) throw new Error("request response already closed");
    if(typeof key!=="string" || key.length<1 || key.length>128) throw new TypeError("invalid message key");
    if(request.active.size>=this.message_concurrency) throw new Error("message capacity exhausted");
    if([...request.active].some(id=>this.messages.get(id)?.key===key)) throw new Error("duplicate message");
    const token=Object.freeze({kind:"http-message",id:this.next_message++,generation:this.generation,request_id:request_token.id});
    this.messages.set(token.id,{token,key,state:"admitted",finished:false});
    request.active.add(token.id);
    return token;
  }
  enter_turn(message_token) {
    const message=this._message(message_token);
    if(message.finished) throw new Error("completed message cannot reenter");
    if(this.physical!==null) throw new Error("actor physical execution already active");
    if(message.state!=="admitted" && message.state!=="suspended") throw new Error("message cannot resume");
    message.state="running";
    this.physical=message_token;
  }
  exit_turn(message_token) {
    const message=this._message(message_token);
    if(this.physical!==message_token) throw new Error("not the executing physical turn");
    this.physical=null;
    if(message.finished) this._retire_message(message);
    else message.state="suspended";
  }
  complete_message(message_token) {
    const message=this._message(message_token);
    if(message.finished) throw new Error("message already completed");
    message.finished=true;
    if(this.physical!==message_token) this._retire_message(message);
  }
  close_response(request_token) {
    const request=this._request(request_token);
    if(request.response_closed) throw new Error("response already closed");
    request.response_closed=true;
    this._retire_request(request);
  }
  cancel_request(request_token) {
    const request=this._request(request_token);
    request.response_closed=true;
    for (const id of [...request.active]) {
      const message=this.messages.get(id);
      if (!message) throw new Error("missing admitted message");
      message.finished=true;
      if(this.physical!==message.token) this._retire_message(message);
    }
    this._retire_request(request);
  }
  _retire_message(message) {
    this.messages.delete(message.token.id);
    const request=this.requests.get(message.token.request_id);
    if(!request) throw new Error("message lost request owner");
    request.active.delete(message.token.id);
    this._retire_request(request);
  }
  _retire_request(request) {
    if(request.response_closed && request.active.size===0)
      this.requests.delete(request.token.id);
  }
  start_shutdown() {this.sealed=true;}
  shutdown_state() {
    if(!this.sealed) return "running";
    return this.requests.size===0 && this.physical===null ? "quiescent":"pending";
  }
  recycle() {
    if(this.shutdown_state()!=="quiescent") throw new Error("cannot recycle before quiescence");
    this.generation++;
    this.next_request=1;
    this.next_message=1;
    this.sealed=false;
  }
  snapshot() {
    return Object.freeze({
      generation:this.generation,
      sealed:this.sealed,
      request_count:this.requests.size,
      message_count:this.messages.size,
      physical_turns:this.physical===null?0:1,
      request_message_counts:Object.freeze([...this.requests.values()].map(x=>x.active.size))
    });
  }
}
