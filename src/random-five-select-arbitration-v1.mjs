// Task #67: deterministic reference arbitration for select/channels.
// This models atomic reservation / one-winner / rollback only; no threads run.
const valid=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,48}$/.test(x);
const reject=code=>Object.freeze({status:'REJECTED',diagnostic:code});
export class ReferenceSelectArbiter{
  constructor(branches){
    if(!Array.isArray(branches)||branches.length<2||branches.length>16||
       branches.some(x=>!valid(x))||new Set(branches).size!==branches.length)
      throw Error('INVALID_SELECT_BRANCHES');
    this.branches=new Set(branches);this.tokens=new Map();
    this.state='OPEN';this.winner=null;this.rollbacks=[];this.sequence=0;
  }
  offer(branch,token,value){
    if(this.state!=='OPEN')return reject('SELECT_ALREADY_TERMINAL');
    if(!this.branches.has(branch)||!valid(token)||this.tokens.has(token)||
       [...this.tokens.values()].some(x=>x.branch===branch)||
       !(typeof value==='string'&&value.length<=2048||Number.isSafeInteger(value)))
      return reject('INVALID_OR_DUPLICATE_RESERVATION');
    this.tokens.set(token,{branch,token,value,order:++this.sequence});
    return Object.freeze({status:'RESERVED',branch,token});
  }
  commit(token){
    if(this.state!=='OPEN')return reject('SELECT_ALREADY_TERMINAL');
    const chosen=this.tokens.get(token);
    if(!chosen)return reject('UNKNOWN_RESERVATION');
    this.state='COMMITTED';this.winner={...chosen};
    for(const [id,entry] of this.tokens)if(id!==token)this.rollbacks.push({...entry});
    this.tokens.clear();
    return Object.freeze({status:'COMMITTED',branch:chosen.branch,token:chosen.token,value:chosen.value});
  }
  cancel(reason='CANCELLED'){
    if(this.state!=='OPEN')return reject('SELECT_ALREADY_TERMINAL');
    if(reason!=='CANCELLED'&&reason!=='TIMEOUT')return reject('INVALID_CANCELLATION');
    this.state=reason;
    for(const entry of this.tokens.values())this.rollbacks.push({...entry});
    this.tokens.clear();
    return Object.freeze({status:reason});
  }
  takeRollback(){
    const entry=this.rollbacks.shift();
    return entry?Object.freeze({status:'ROLLED_BACK',...entry}):Object.freeze({status:'EMPTY'});
  }
  snapshot(){
    return Object.freeze({state:this.state,reserved:this.tokens.size,winner:this.winner?
       Object.freeze({...this.winner}):null,rollbackPending:this.rollbacks.length});
  }
}
