/** Source-free authenticated frame/replay contract; not a socket or MAC implementation. */
export class AuthenticatedFrameOracle {
  #epoch; #generation; #lastMessage=0; #lastFrame=0;
  constructor(epoch,generation){
    if(!epoch||typeof epoch!=="string"||!/^[A-Za-z0-9_.-]{1,64}$/.test(epoch))
      throw new RangeError("epoch");
    if(!Number.isSafeInteger(generation)||generation<=0)throw new RangeError("generation");
    this.#epoch=epoch;this.#generation=generation;
  }
  static boundedWireLength(kind,length){
    if(!Number.isSafeInteger(length)||length<32)return false;
    if(kind==="RECEIPT")return length<=1024;
    if(kind==="DATA")return length<=8*1024*1024+1024;
    return false;
  }
  acceptData({epoch,generation,messageSequence,frameSequence,macValid=true}){
    if(!macValid)throw Error("authentication");
    if(epoch!==this.#epoch||generation!==this.#generation)throw Error("epoch/generation");
    if(!Number.isSafeInteger(messageSequence)||!Number.isSafeInteger(frameSequence)||
       messageSequence<=this.#lastMessage||frameSequence<=this.#lastFrame)
      throw Error("replay/reorder");
    this.#lastMessage=messageSequence;this.#lastFrame=frameSequence;
    return Object.freeze({messageSequence,frameSequence});
  }
  state(){return Object.freeze({lastMessage:this.#lastMessage,lastFrame:this.#lastFrame});}
  invariant(){return this.#lastMessage>=0&&this.#lastFrame>=0;}
}


/** Source-free same-process physical transport owner binding contract. */
export class PhysicalBindingOracle {
  #owner=null; #epoch=null; #generation=0;
  claim(owner,epoch,generation){
    if(owner===null||owner===undefined||!epoch||
       !Number.isSafeInteger(generation)||generation<=0) throw Error("binding");
    if(this.#owner!==null) throw Error("rebind");
    this.#owner=owner;this.#epoch=epoch;this.#generation=generation;
  }
  require(owner,epoch,generation){
    if(this.#owner===null)throw Error("unbound");
    if(owner!==this.#owner||epoch!==this.#epoch||generation!==this.#generation)
      throw Error("foreign/stale");
    return true;
  }
  legacyAllowed(){return this.#owner===null;}
}
