/** Validate a complete Node TAP v13 stream, never certify a compiler. */
const deny = reason => { throw new Error('wave9-test-evidence: '+reason); };
function count(lines,key){
 const matches=lines.filter(x=>x.startsWith('# '+key+' '));
 if(matches.length!==1 || !new RegExp('^# '+key+' (0|[1-9][0-9]*)$').test(matches[0])) deny('missing/duplicate/noncanonical '+key+' summary');
 const n=Number(matches[0].slice(('# '+key+' ').length));
 if(!Number.isSafeInteger(n))deny('unsafe TAP count '+key);
 return n;
}
export function assessTap(stdout,{minimumTests=1}={}){
 if(typeof stdout!=='string'||stdout.length>2*1024*1024||!stdout.startsWith('TAP version 13\n')) deny('missing or oversized TAP v13 stream');
 if(!Number.isSafeInteger(minimumTests)||minimumTests<1||minimumTests>2000)deny('invalid minimum count');
 const lines=stdout.split(/\r?\n/);
 if(lines.filter(x=>x==='TAP version 13').length!==1 || lines.some(x=>/^\s*Bail out!/i.test(x)))deny('duplicate TAP header or bailout');
 const plan=lines.filter(x=>/^1\.\.[0-9]+$/.test(x));
 if(plan.length!==1)deny('missing or duplicated top-level TAP plan');
 const planned=Number(plan[0].slice(3));
 const cases=[];
 for(const line of lines){
  if(/^not ok \d+\b/.test(line)||/^\s+not ok \d+\b/.test(line))deny('failed TAP assertion');
  const match=/^ok (0|[1-9]\d*) - (.+)$/.exec(line);
  if(match)cases.push(Number(match[1]));
 }
 const counts=Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(k=>[k,count(lines,k)]));
 if(planned!==counts.tests||counts.tests<minimumTests||counts.tests>2000||cases.length!==planned||cases.some((n,i)=>n!==i+1))deny('TAP plan and enumerated assertions disagree');
 if(counts.pass!==counts.tests||counts.fail||counts.cancelled||counts.skipped||counts.todo)deny('tests absent, failed, skipped, cancelled or TODO');
 return Object.freeze({status:'EXECUTED_NODE_TESTS',counts,hostOnly:true,compilerParityVerified:false});
}
export function assessProcess(result,{minimumTests=1}={}){
 if(!result||result.error||result.signal||result.status!==0)deny('Node process did not finish successfully');
 if(typeof result.stderr!=='string'||result.stderr.length!==0)deny('unexpected stderr from test runner');
 return assessTap(result.stdout,{minimumTests});
}
