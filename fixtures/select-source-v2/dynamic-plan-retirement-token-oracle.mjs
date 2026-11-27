// Reference model for invocation-token ABA fencing and terminal arbitration.
// No compiler or guest execution is implied.
function verifyRetirement(){
 let checks=0;const check=(v,m)=>{checks++;if(!v)throw Error(m)};
 const actions=["commit","cancel","timeout","stop","reject","stale"];
 let active=0,cursor=0,next=0,slot={token:0,state:"free",version:0},version=0,consumed=0,releases=0;
 function admit(){check(slot.state==="free","slot not free");slot={token:++next,state:"pending",version};active++;return {...slot}}
 function event(t,kind){if(slot.state!=="pending"||slot.token!==t.token)return false;if(kind==="stale")return false;slot.state="free";active--;releases++;if(kind==="commit"){consumed++;if(t.version===version)cursor++}return true}
 for(let x of actions)for(let y of actions)for(let z of actions)for(let mutate of [false,true]){
   let t=admit(),c=cursor,n=consumed,r=releases;if(mutate)version++;
   let events=[x,y,z],winner=events.find(e=>e!=="stale");if(!winner){events.push("cancel");winner="cancel"}
   let wins=events.map(e=>event(t,e)).filter(Boolean).length;
   check(wins===1&&active===0,"exactly one retirement");check(releases===r+1,"exactly one release");
   check(consumed===n+(winner==="commit"?1:0),"only commit consumes");check(cursor===c+(winner==="commit"&&!mutate?1:0),"generation fence");
   let fresh=admit();let before=consumed;for(let a of actions)check(!event(t,a),"stale token cannot target recycled slot");
   check(active===1&&slot.token===fresh.token&&consumed===before,"stale events preserve fresh invocation");
   check(event(fresh,"cancel"),"fresh cancellation");check(active===0,"no leak");
 }
 return {checks,retirements:releases,active,uniqueTokens:next};
}
console.log(JSON.stringify(verifyRetirement()));
