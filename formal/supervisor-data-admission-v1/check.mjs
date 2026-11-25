#!/usr/bin/env node
// Standalone bounded logic model: not compiled Java, TLC, native release or production parity.
function exploreSupervisorDataAdmissionV1() {
    const fresh = () => ({
        fenced:false, pending:false, physicalReleased:false, restarted:false,
        sends:[0,0,0], sibling:0, active:0, accepted:0, committed:0,
        aborted:0, postFenceCommits:0, grantAfterFence:0, siblingFenced:false
    });
    const clone = s => JSON.parse(JSON.stringify(s));
    const assert = (ok, reason) => { if (!ok) throw Error(reason); };
    const valid = s => {
        const inFlight=s.sends.filter(x=>x===1).length;
        const accepted=s.sends.filter(x=>x===1||x===2||x===3).length;
        if(s.active!==inFlight ||s.accepted!==accepted) return false;
        if(s.committed!==s.sends.filter(x=>x===2).length) return false;
        if(s.aborted!==s.sends.filter(x=>x===3).length) return false;
        if(s.grantAfterFence!==0||s.siblingFenced) return false;
        if(s.accepted!==s.committed+s.aborted+s.active) return false;
        if(!s.fenced&&(s.pending||s.physicalReleased||s.restarted))return false;
        if(s.physicalReleased&&(!s.fenced||s.active!==0))return false;
        if(s.restarted&&(!s.physicalReleased||s.pending||s.active!==0))return false;
        if(s.postFenceCommits>s.committed)return false;
        return true;
    };
    const successors=s=>{
        const out=[];
        for(let i=0;i<3;i++){
            if(s.sends[i]===0){
                let t=clone(s);
                if(!s.fenced){t.sends[i]=1;t.active++;t.accepted++;out.push([`grant:${i}`,t]);}
                else {t.sends[i]=4;out.push([`reject:${i}`,t]);}
            }else if(s.sends[i]===1){
                let t=clone(s);t.sends[i]=2;t.active--;t.committed++;if(s.fenced)t.postFenceCommits++;out.push([`commit:${i}`,t]);
                t=clone(s);t.sends[i]=3;t.active--;t.aborted++;out.push([`abort:${i}`,t]);
            }
        }
        if(s.sibling===0){let t=clone(s);t.sibling=1;out.push(["sibling:grant",t]);}
        if(s.sibling===1){let t=clone(s);t.sibling=2;out.push(["sibling:commit",t]);}
        if(!s.fenced){let t=clone(s);t.fenced=true;t.pending=true;out.push(["crash:fence",t]);}
        if(s.pending){let t=clone(s);t.pending=false;out.push(["ack:notice",t]);}
        if(s.fenced&&!s.physicalReleased&&s.active===0){
            let t=clone(s);t.physicalReleased=true;out.push(["verify:physical",t]);
        }
        if(s.fenced&&!s.pending&&s.physicalReleased&&s.active===0&&!s.restarted){
            let t=clone(s);t.restarted=true;out.push(["restart:generation2",t]);
        }
        return out;
    };
    const first=fresh(),queue=[first],visited=new Set([JSON.stringify(first)]),counts={},witness={};
    for(let i=0;i<queue.length;i++){
        const s=queue[i];assert(valid(s),`invalid explored state ${i}`);
        if(s.postFenceCommits>0 && witness.preFencePermitFinishesAfterCrash===undefined)witness.preFencePermitFinishesAfterCrash=i;
        if(s.fenced&&s.sends.includes(4)&&witness.postFenceGrantRejected===undefined)witness.postFenceGrantRejected=i;
        if(s.fenced&&s.sibling===2&&witness.independentSiblingProgress===undefined)witness.independentSiblingProgress=i;
        if(s.restarted&&witness.restartAfterDrainAckPhysical===undefined)witness.restartAfterDrainAckPhysical=i;
        if(s.fenced&&s.pending&&s.active>0&&witness.failureRetainsActivePermits===undefined)witness.failureRetainsActivePermits=i;
        for(const [act,t]of successors(s)){
            assert(valid(t),`invariant failed on ${act}`);
            counts[act]=(counts[act]||0)+1;
            const key=JSON.stringify(t);
            if(!visited.has(key)){visited.add(key);queue.push(t);if(queue.length>60000)throw Error("state bound exceeded");}
        }
    }
    const s0=fresh(),accepted=successors(s0).find(([x])=>x==="grant:0")[1];
    const crashed=successors(accepted).find(([x])=>x==="crash:fence")[1];
    const finished=successors(crashed).find(([x])=>x==="commit:0")[1];
    assert(valid(finished)&&finished.postFenceCommits===1,"pre-fence commit witness broken");
    const mut1=clone(crashed);mut1.grantAfterFence=1;assert(!valid(mut1),"post-fence grant mutation escaped");
    const mut2=clone(crashed);mut2.active=0;assert(!valid(mut2),"permit disappearance escaped");
    const mut3=clone(crashed);mut3.restarted=true;assert(!valid(mut3),"premature restart escaped");
    const mut4=clone(crashed);mut4.physicalReleased=true;assert(!valid(mut4),"premature physical receipt escaped");
    const mut5=clone(crashed);mut5.siblingFenced=true;assert(!valid(mut5),"sibling mutation escaped");
    for(const x of ["preFencePermitFinishesAfterCrash","postFenceGrantRejected","independentSiblingProgress","restartAfterDrainAckPhysical","failureRetainsActivePermits"])assert(witness[x]!==undefined,"missing witness "+x);
    return {classification:"BOUNDED_MODEL_ONLY",states:queue.length,transitions:Object.values(counts).reduce((a,b)=>a+b,0),actions:Object.keys(counts).length,witness,mutationsRejected:5};
}
const result=exploreSupervisorDataAdmissionV1();
if(typeof process!=='undefined'&&process.stdout)process.stdout.write(JSON.stringify(result)+'\n');
