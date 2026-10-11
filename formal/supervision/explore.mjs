export function explore({owners=[0,0],supervisors=1,maxGeneration=2,maxTurns=2,mutant=false,maxStates=250000}={}) {
  const N=owners.length;
  if (!N || owners.some(x=>!Number.isInteger(x)||x<0||x>=supervisors)) throw Error("invalid owner assignment");
  const init={phase:Array(N).fill("Active"),gen:Array(N).fill(1),cleanup:Array(N).fill(false),
    lease:Array(N).fill(0),receipt:Array(N).fill("None"),calls:Array(N).fill(0),
    applied:Array(N).fill(false),proof:Array(N).fill(false),committed:Array(N).fill(0),
    turn:Array(N).fill(0),control:Array(supervisors).fill(-1),
    closed:Array(supervisors).fill(false),nextTurn:Array(supervisors).fill(0)};
  const invalid=s=>{
    const errors=[];
    for(let c=0;c<N;c++){
      const p=s.phase[c],r=s.receipt[c],g=s.gen[c],k=owners[c];
      if(!["Active","Finalized","Restarting","Stopping","Stopped"].includes(p))errors.push("InvalidPhase");
      if(g<1||g>maxGeneration)errors.push("InvalidGeneration");
      if(s.calls[c]<0||s.calls[c]>1)errors.push("NoDuplicateEffects");
      if(p!=="Active"&&!s.cleanup[c])errors.push("CleanupBeforeSupervisor");
      if(["Stopping","Restarting","Stopped"].includes(p)&&s.lease[c]!==g)errors.push("NoStaleIncarnationCommit");
      if(p==="Stopping"&&!["Pending","Uncertain","Applied"].includes(r))errors.push("MissingStopReservation");
      if(p==="Stopped"&&r!=="Ack")errors.push("NoInvalidStopCommit");
      if(["Active","Finalized","Restarting"].includes(p)&&r!=="None")errors.push("NoStopRestartOverlap");
      if(r==="Ack"&&!(p==="Stopped"&&s.applied[c]&&s.calls[c]===1&&s.committed[c]===g))errors.push("NoUnverifiedStop");
      if(s.proof[c]&&!s.applied[c])errors.push("ForgedHostProof");
      if(r==="Applied"&&!s.applied[c])errors.push("UnappliedHostReceipt");
      if(p==="Restarting"&&!s.closed[k]&&s.control[k]!==c)errors.push("RestartOutsideLiveControl");
      if(p==="Stopping"&&s.turn[c]===0)errors.push("STOPWithoutControlTurn");
    }
    for(let k=0;k<supervisors;k++){
      const c=s.control[k];
      if(s.closed[k]&&c!==-1)errors.push("ClosedControlOwner");
      if(c!==-1&&(c<0||c>=N||owners[c]!==k))errors.push("ForeignControlOwner");
    }
    return [...new Set(errors)];
  };
  const states=[init],parents=[-1],labels=["Init"],seen=new Set([JSON.stringify(init)]);
  let transitions=0;
  for(let q=0;q<states.length;q++){
    const s=states[q],errors=invalid(s);
    if(errors.length){const trace=[];for(let i=q;i>=0;i=parents[i])trace.push(labels[i]);
      return {ok:false,states:states.length,transitions,violations:errors,trace:trace.reverse(),owners,supervisors,maxGeneration,maxTurns};}
    const emit=(label,update)=>{
      const next=JSON.parse(JSON.stringify(s));update(next);transitions++;
      const key=JSON.stringify(next);
      if(!seen.has(key)){seen.add(key);states.push(next);parents.push(q);labels.push(label);
        if(states.length>maxStates)throw Error("MODEL_BOUND_EXCEEDED:"+states.length);}
    };
    for(let c=0;c<N;c++){
      const k=owners[c],p=s.phase[c],r=s.receipt[c];
      if(p==="Active"&&!s.cleanup[c])emit(`Cleanup(${c})`,x=>x.cleanup[c]=true);
      if(p==="Active"&&s.cleanup[c])emit(`Finalize(${c})`,x=>x.phase[c]="Finalized");
      if(p==="Finalized"&&s.control[k]===-1&&!s.closed[k]&&s.nextTurn[k]<maxTurns)
        emit(`AcquireControl(${c})`,x=>{x.control[k]=c;x.nextTurn[k]++;x.turn[c]=x.nextTurn[k];});
      if(p==="Finalized"&&s.control[k]===c&&r==="None"){
        emit(`ReserveStop(${c})`,x=>{x.phase[c]="Stopping";x.receipt[c]="Pending";x.lease[c]=x.gen[c];});
        emit(`ReserveRestart(${c})`,x=>{x.phase[c]="Restarting";x.lease[c]=x.gen[c];});
      }
      if(p==="Restarting"){
        if(s.control[k]===c)emit(`AbortRestart(${c})`,x=>{x.phase[c]="Finalized";x.lease[c]=0;});
        if(s.control[k]===c&&s.gen[c]<maxGeneration&&!s.closed[k])
          emit(`CommitRestart(${c})`,x=>{x.phase[c]="Active";x.gen[c]++;x.cleanup[c]=false;x.lease[c]=0;
            x.calls[c]=0;x.applied[c]=false;x.proof[c]=false;x.turn[c]=0;x.control[k]=-1;});
      }
      if(p==="Stopping"){
        if(r==="Pending"&&s.calls[c]===0&&s.control[k]===c&&!s.closed[k])
          emit(`StartHostEffect(${c})`,x=>x.calls[c]=1);
        if(r==="Pending"&&s.calls[c]===1){
          if(s.control[k]===c&&!s.closed[k])
            emit(`HostSuccess(${c})`,x=>{x.receipt[c]="Applied";x.applied[c]=true;});
          emit(`HostUnknownNotApplied(${c})`,x=>{x.receipt[c]="Uncertain";x.applied[c]=false;});
          emit(`HostUnknownApplied(${c})`,x=>{x.receipt[c]="Uncertain";x.applied[c]=true;});
          if(mutant)emit(`UNSAFE_HostReplay(${c})`,x=>x.calls[c]++);
        }
        if(r==="Applied"&&s.applied[c]&&s.control[k]===c&&!s.closed[k])
          emit(`CommitStop(${c})`,x=>{x.phase[c]="Stopped";x.receipt[c]="Ack";x.committed[c]=x.gen[c];x.control[k]=-1;});
        if(["Pending","Uncertain"].includes(r)&&s.applied[c]&&!s.proof[c]&&s.calls[c]===1)
          emit(`IndependentHostProof(${c})`,x=>x.proof[c]=true);
        if(["Pending","Uncertain"].includes(r)&&s.applied[c]&&s.proof[c])
          emit(`Reconcile(${c})`,x=>{x.phase[c]="Stopped";x.receipt[c]="Ack";x.committed[c]=x.gen[c];if(x.control[k]===c)x.control[k]=-1;});
      }
    }
    for(let k=0;k<supervisors;k++)if(!s.closed[k])
      emit(`CloseSupervisor(${k})`,x=>{x.closed[k]=true;x.control[k]=-1;});
  }
  return {ok:true,states:states.length,transitions,owners,supervisors,maxGeneration,maxTurns};
}
