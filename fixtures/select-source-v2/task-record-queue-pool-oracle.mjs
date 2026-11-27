// Independent storage/accounting oracle, not executed guest/compiler evidence.
function verifyPools(){
 let checks=0;const check=(v,m)=>{checks++;if(!v)throw Error(m)};
 const freeTasks=[],freeNodes=[],tasks=[],nodes=[],liveTasks=new Set(),queues=Array.from({length:8},()=>({head:null,tail:null,expected:[]})),futures=[];
 let maxTasks=0,maxNodes=0,queued=0;
 function spawn(v){let t=freeTasks.pop();if(!t){t={};tasks.push(t)}check(!t.future,"clean task record");let f={done:false,value:null};Object.assign(t,{future:f,value:v});liveTasks.add(t);futures.push({f,v});maxTasks=Math.max(maxTasks,liveTasks.size);return t}
 function finish(t){check(liveTasks.delete(t),"unique task retirement");let f=t.future;f.value=t.value;f.done=true;t.future=null;t.value=null;freeTasks.push(t);return f}
 function push(q,v){let n=freeNodes.pop();if(!n){n={};nodes.push(n)}check(n.value==null,"clean queue node");n.value=v;n.next=null;if(q.tail)q.tail.next=n;else q.head=n;q.tail=n;q.expected.push(v);maxNodes=Math.max(maxNodes,++queued)}
 function pop(q){let n=q.head;check(!!n,"pop nonempty");let v=n.value;q.head=n.next;if(!q.head)q.tail=null;n.value=null;n.next=null;freeNodes.push(n);queued--;check(v===q.expected.shift(),"FIFO across reuse");return v}
 function audit(){let seen=new Set();for(let q of queues){let a=[],t=q.head,last=null;while(t){check(!seen.has(t),"node cannot alias queues");seen.add(t);a.push(t.value);last=t;t=t.next}check(last===q.tail&&a.length===q.expected.length&&a.every((v,i)=>v===q.expected[i]),"head tail data integrity")}check(seen.size===queued,"queue count");check(new Set(freeNodes).size===freeNodes.length&&freeNodes.every(n=>!seen.has(n)),"free queue exclusive");check(nodes.length===queued+freeNodes.length&&nodes.length<=maxNodes,"queue pool accounting");check(tasks.length===liveTasks.size+freeTasks.length&&tasks.length<=maxTasks,"task pool accounting");check(new Set(freeTasks).size===freeTasks.length&&freeTasks.every(t=>!liveTasks.has(t)&&!t.future),"task pool exclusive")}
 let seed=0x91ab23;for(let i=0;i<20000;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;let q=queues[(seed>>>12)%8];if(q.expected.length===0||((seed>>>24)%2===0&&q.expected.length<16))push(q,i);else pop(q);let t=spawn(i);finish(t);if(i%37===0)audit()}
 for(let q of queues)while(q.head)pop(q);audit();for(let {f,v} of futures)check(f.done&&f.value===v,"old future unchanged across task record reuse");return {checks,completedFutures:futures.length,taskRecords:tasks.length,queueNodes:nodes.length,peakQueued:maxNodes,liveTasks:liveTasks.size,queued}
}
console.log(JSON.stringify(verifyPools()));
