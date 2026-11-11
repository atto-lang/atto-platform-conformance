/**
 * Executable bounded HTTP actor admission and shutdown reference model.
 * No claim of AttoLang compiler/guest execution, scheduling fairness or CI provenance.
 * Graceful drain retains prior request authority; forced stop revokes all new
 * admission while preserving active carrier exit obligations.
 * Single physical guest turn per actor incarnation even when many request/message
 * lifetimes are admitted. Token object identity is the source-free capability oracle.
 */
export class HttpActorAdmissionModel {
  #request_concurrency;
  #message_concurrency;
  #generation;
  #next_request;
  #next_message;
  #sealed;
  #force_stopped;
  #requests;
  #messages;
  #request_tokens;
  #message_tokens;
  #physical;
  constructor({request_concurrency=1,message_concurrency=1}={}) {
    for (const [name,n] of Object.entries({request_concurrency,message_concurrency})) {
      if (!Number.isSafeInteger(n) || n<1 || n>64) throw new RangeError(`${name} must be 1..64`);
    }
    this.#request_concurrency=request_concurrency;
    this.#message_concurrency=message_concurrency;
    this.#generation=1;
    this.#next_request=1;
    this.#next_message=1;
    this.#sealed=false;
    this.#force_stopped=false;
    this.#requests=new Map();
    this.#messages=new Map();
    // Exact identity, never invoke getters from forged token objects.
    this.#request_tokens=new WeakMap();
    this.#message_tokens=new WeakMap();
    this.#physical=null;
    // External callers cannot add shadow state keys.
    Object.preventExtensions(this);
  }
  _request(token) {
    const value=token && typeof token==="object" ? this.#request_tokens.get(token) : undefined;
    if (!value || value.generation!==this.#generation ||
        this.#requests.get(value.id)!==value)
      throw new Error("stale or forged request capability");
    return value;
  }
  _message(token) {
    const value=token && typeof token==="object" ? this.#message_tokens.get(token) : undefined;
    if (!value || value.generation!==this.#generation ||
        this.#messages.get(value.id)!==value)
      throw new Error("stale or forged message capability");
    return value;
  }
  admit_request(key) {
    if(this.#sealed) throw new Error("request admission sealed");
    if (typeof key!=="string" || key.length<1 || key.length>128) throw new TypeError("invalid request key");
    if(this.#requests.size>=this.#request_concurrency) throw new Error("request capacity exhausted");
    if([...this.#requests.values()].some(r=>r.key===key)) throw new Error("duplicate request");
    if(!Number.isSafeInteger(this.#next_request)) throw new Error("request token counter exhausted");
    const id=this.#next_request++;
    const token=Object.freeze({kind:"http-request",id,generation:this.#generation});
    const record={id,generation:this.#generation,token,key,response_closed:false,active:new Set()};
    this.#requests.set(id,record);
    this.#request_tokens.set(token,record);
    return token;
  }
  admit_message(request_token,key) {
    // Graceful shutdown denies new requests, not preexisting request work.
    // A forced stop revokes both request and message admission.
    if(this.#force_stopped) throw new Error("message admission sealed");
    const request=this._request(request_token);
    if(request.response_closed) throw new Error("request response already closed");
    if(typeof key!=="string" || key.length<1 || key.length>128) throw new TypeError("invalid message key");
    if(request.active.size>=this.#message_concurrency) throw new Error("message capacity exhausted");
    if([...request.active].some(id=>this.#messages.get(id)?.key===key)) throw new Error("duplicate message");
    if(!Number.isSafeInteger(this.#next_message)) throw new Error("message token counter exhausted");
    const id=this.#next_message++;
    const token=Object.freeze({kind:"http-message",id,generation:this.#generation,request_id:request.id});
    const record={id,generation:this.#generation,token,key,state:"admitted",finished:false};
    this.#messages.set(id,record);
    this.#message_tokens.set(token,record);
    request.active.add(id);
    return token;
  }
  enter_turn(message_token) {
    const message=this._message(message_token);
    if(message.finished) throw new Error("completed message cannot reenter");
    if(this.#physical!==null) throw new Error("actor physical execution already active");
    if(message.state!=="admitted" && message.state!=="suspended") throw new Error("message cannot resume");
    message.state="running";
    this.#physical=message_token;
  }
  exit_turn(message_token) {
    const message=this._message(message_token);
    if(this.#physical!==message_token) throw new Error("not the executing physical turn");
    this.#physical=null;
    if(message.finished) this._retire_message(message);
    else message.state="suspended";
  }
  complete_message(message_token) {
    const message=this._message(message_token);
    if(message.finished) throw new Error("message already completed");
    message.finished=true;
    if(this.#physical!==message_token) this._retire_message(message);
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
      const message=this.#messages.get(id);
      if (!message) throw new Error("missing admitted message");
      message.finished=true;
      if(this.#physical!==message.token) this._retire_message(message);
    }
    this._retire_request(request);
  }
  _retire_message(message) {
    this.#messages.delete(message.token.id);
    const request=this.#requests.get(message.token.request_id);
    if(!request) throw new Error("message lost request owner");
    request.active.delete(message.token.id);
    this._retire_request(request);
  }
  _retire_request(request) {
    if(request.response_closed && request.active.size===0)
      this.#requests.delete(request.token.id);
  }
  start_shutdown() {this.#sealed=true;}
  force_stop() {
    this.#sealed=true;
    if(this.#force_stopped) return false;
    this.#force_stopped=true;
    for (const request of [...this.#requests.values()])
      this.cancel_request(request.token);
    return true;
  }
  shutdown_state() {
    if(!this.#sealed) return "running";
    return this.#requests.size===0 && this.#messages.size===0 &&
      this.#physical===null ? "quiescent":"pending";
  }
  recycle() {
    if(this.shutdown_state()!=="quiescent") throw new Error("cannot recycle before quiescence");
    if(!Number.isSafeInteger(this.#generation+1)) throw new Error("actor incarnation exhausted");
    this.#generation++;
    this.#next_request=1;
    this.#next_message=1;
    this.#sealed=false;
    this.#force_stopped=false;
    this.#request_tokens=new WeakMap();
    this.#message_tokens=new WeakMap();
  }
  snapshot() {
    return Object.freeze({
      generation:this.#generation,
      sealed:this.#sealed,
      force_stopped:this.#force_stopped,
      request_count:this.#requests.size,
      message_count:this.#messages.size,
      physical_turns:this.#physical===null?0:1,
      request_message_counts:Object.freeze([...this.#requests.values()].map(x=>x.active.size))
    });
  }
}
