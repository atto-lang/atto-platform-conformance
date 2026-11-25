import {types as nodeTypes} from 'node:util';
/**
 * Advisory, offline AttoLang PR wave coordinator. No GitHub writes, CI bypasses,
 * private-source export or merge authority. All inputs are untrusted until
 * separately authenticated against GitHub on the exact PR head.
 */
const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const LOGIN = /^[A-Za-z0-9-]{1,39}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const ID = /^[a-zA-Z0-9_.:-]{8,96}$/;
const LEASE_PREFIX = 'ATTO_PR_LEASE_V1 ';

const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const leaseFields=['claimId','expiresAt','head','issuedAt','number','owner',
  'paths','repo','scope','status'];
// Never invoke untrusted Proxy traps, accessors, prototypes or iterable hooks
// while deciding a file/merge ownership claim.
function ownDataRecord(value,fields) {
  if(!isObject(value) || nodeTypes.isProxy(value) ||
      ![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
  const keys=Reflect.ownKeys(value);
  return keys.length===fields.length&&keys.every(key=>{
    const d=Object.getOwnPropertyDescriptor(value,key);
    return typeof key==='string'&&fields.includes(key)&&!!d&&
      d.enumerable&&Object.hasOwn(d,'value');
  });
}
function snapshotLease(value) {
  if(!ownDataRecord(value,leaseFields))throw err('INVALID_LEASE_SHAPE');
  const data=Object.fromEntries(leaseFields.map(key=>[
    key,Object.getOwnPropertyDescriptor(value,key).value
  ]));
  const paths=data.paths;
  if(!Array.isArray(paths)||nodeTypes.isProxy(paths)||
      Object.getPrototypeOf(paths)!==Array.prototype||
      paths.length>30)throw err('INVALID_LEASE_SCOPE');
  const pathKeys=Reflect.ownKeys(paths);
  if(pathKeys.length!==paths.length+1 || pathKeys[paths.length]!=='length')
    throw err('INVALID_LEASE_SCOPE');
  const copied=[];
  for(let i=0;i<paths.length;i++){
    if(pathKeys[i]!==String(i))throw err('INVALID_LEASE_SCOPE');
    const d=Object.getOwnPropertyDescriptor(paths,String(i));
    if(!d||!d.enumerable||!Object.hasOwn(d,'value'))
      throw err('INVALID_LEASE_SCOPE');
    copied.push(d.value);
  }
  return Object.freeze({...data,paths:Object.freeze(copied)});
}
function ownCommentField(comment,key){
  if(!isObject(comment)||nodeTypes.isProxy(comment)||
      ![Object.prototype,null].includes(Object.getPrototypeOf(comment)))
    throw err('INVALID_LEASE_COMMENT');
  const d=Object.getOwnPropertyDescriptor(comment,key);
  if(!d||!Object.hasOwn(d,'value'))throw err('INVALID_LEASE_COMMENT');
  return d.value;
}
const validDate = s => typeof s === 'string' && ISO.test(s) &&
  Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
const validPath = p => typeof p === 'string' && p.length > 0 && p.length <= 200 &&
  !p.startsWith('/') && !p.endsWith('/') && !p.includes('\\') && !p.includes('//') &&
  p.split('/').every(c => c !== '.' && c !== '..' && c.length > 0 && /^[a-zA-Z0-9_.-]+$/.test(c));
const key = p => p.repo + '#' + p.number;
const err = (code, detail = '') => Object.assign(new Error(code + (detail ? ': ' + detail : '')), {code});
const uniq = a => [...new Set(a)];

export function validateLease(input, {now, trusted = ['the1mills','ORESoftware']} = {}) {
  const lease=snapshotLease(input);
  if (!REPO.test(lease.repo) || !Number.isSafeInteger(lease.number) || lease.number < 1 ||
      !SHA.test(lease.head) || !LOGIN.test(lease.owner) || !ID.test(lease.claimId) ||
      !Array.isArray(trusted) || !trusted.some(x => typeof x === 'string' && x.toLowerCase() === lease.owner.toLowerCase()))
    throw err('INVALID_LEASE_IDENTITY');
  if (!['files','merge'].includes(lease.scope) || !['active','released'].includes(lease.status) ||
      !Array.isArray(lease.paths) || (lease.scope === 'merge' && lease.paths.length !== 0) ||
      (lease.scope === 'files' && (lease.paths.length === 0 || lease.paths.length > 30)) ||
      lease.paths.some(x => !validPath(x)) || new Set(lease.paths).size !== lease.paths.length)
    throw err('INVALID_LEASE_SCOPE');
  if (!validDate(lease.issuedAt) || !validDate(lease.expiresAt) ||
      Date.parse(lease.expiresAt) - Date.parse(lease.issuedAt) <= 0 ||
      Date.parse(lease.expiresAt) - Date.parse(lease.issuedAt) > 45 * 60_000)
    throw err('INVALID_LEASE_TIME');
  if (now !== undefined && (!validDate(now) || Date.parse(lease.issuedAt) > Date.parse(now) + 30_000))
    throw err('LEASE_FROM_FUTURE');
  return lease;
}

/** Exact one-line canonical encoding prevents duplicate-key/last-wins ambiguity. */
export function serializeLease(input) {
  const lease=validateLease(input);
  const canonical = Object.fromEntries(Object.keys(lease).sort().map(k => [k,lease[k]]));
  return LEASE_PREFIX + JSON.stringify(canonical);
}
export function parseLeaseComment(comment, opts = {}) {
  const body=ownCommentField(comment,'body');
  const author=ownCommentField(comment,'author');
  const createdAt=ownCommentField(comment,'createdAt');
  if (typeof body !== 'string' || body.length > 4096 || !body.startsWith(LEASE_PREFIX) || body.includes('\n'))
    throw err('INVALID_LEASE_COMMENT');
  const raw = body.slice(LEASE_PREFIX.length);
  let lease;
  try { lease = JSON.parse(raw); } catch { throw err('INVALID_LEASE_JSON'); }
  if (JSON.stringify(Object.fromEntries(Object.keys(lease).sort().map(k => [k,lease[k]]))) !== raw)
    throw err('NONCANONICAL_LEASE_JSON');
  const snapshot=validateLease(lease, opts);
  if (typeof author !== 'string' || author.toLowerCase() !== snapshot.owner.toLowerCase())
    throw err('LEASE_AUTHOR_MISMATCH');
  if (!validDate(createdAt) || Date.parse(createdAt) < Date.parse(lease.issuedAt) - 30_000 ||
      Date.parse(createdAt) > Date.parse(lease.issuedAt) + 30_000)
    throw err('LEASE_COMMENT_TIME_MISMATCH');
  return snapshot;
}
function pathsOverlap(a,b) {
  return a.some(x => b.some(y => x === y || x.startsWith(y + '/') || y.startsWith(x + '/')));
}

/**
 * Evaluates an append-only issue comment ledger. A conflict is ALWAYS a denial.
 * This is collision detection, not an atomic exclusivity claim: after checking,
 * agents need a GitHub server-side compare-and-swap lease before any write.
 */
export function evaluateLeaseLedger(comments,{now,repo,number,head,trusted}={}) {
  if (!Array.isArray(comments) || comments.length > 1000 ||
      !validDate(now) || !REPO.test(repo) || !Number.isSafeInteger(number) || number < 1 || !SHA.test(head))
    throw err('INVALID_LEASE_LEDGER_INPUT');
  const blockers = [],claims = new Map();
  for (const comment of comments) {
    let body;
    try { body=ownCommentField(comment,'body'); }
    catch { blockers.push('INVALID_LEASE_RECORD'); continue; }
    if (typeof body !== 'string' || !body.startsWith(LEASE_PREFIX)) continue;
    let lease;
    try { lease = parseLeaseComment(comment,{now,trusted}); }
    catch { blockers.push('INVALID_LEASE_RECORD'); continue; }
    if (lease.repo !== repo || lease.number !== number) { blockers.push('MISROUTED_LEASE_RECORD'); continue; }
    const previous=claims.get(lease.claimId);
    if (previous && (previous.owner !== lease.owner || previous.scope !== lease.scope ||
        JSON.stringify(previous.paths) !== JSON.stringify(lease.paths) ||
        previous.head !== lease.head || previous.status === 'released' ||
        Date.parse(lease.issuedAt) < Date.parse(previous.issuedAt) ||
        Date.parse(lease.issuedAt) > Date.parse(previous.expiresAt))) {
      blockers.push('INVALID_LEASE_TRANSITION'); continue;
    }
    claims.set(lease.claimId,lease);
  }
  const live=[...claims.values()].filter(x => x.status === 'active' && Date.parse(x.expiresAt) > Date.parse(now));
  if (live.some(x=>x.head!==head)) blockers.push('LEASE_HEAD_CHANGED');
  for(let i=0;i<live.length;i++)for(let j=i+1;j<live.length;j++){
    const a=live[i], b=live[j];
    if(a.scope==='merge' || b.scope==='merge' || pathsOverlap(a.paths,b.paths))
      blockers.push('CONCURRENT_LEASE_CONFLICT');
  }
  return {advisoryOnly:true, exclusiveLockAcquired:false, mergeAuthorized:false,
    active:live,blockers:uniq(blockers)};
}

/** Deterministic, fail-closed topological merge-wave planner. */
export function planMergeWave(prs,{minimumPRs=5,minimumRepos=3}={}) {
  if (!Array.isArray(prs) || prs.length>100 || !Number.isSafeInteger(minimumPRs) || minimumPRs<5 ||
      !Number.isSafeInteger(minimumRepos) || minimumRepos<3)
    throw err('INVALID_WAVE_POLICY');
  const blockers=[], byId=new Map(),edges=new Map(),indegree=new Map();
  const fail=code=>{if(!blockers.includes(code))blockers.push(code);};
  for(const p of prs){
    if(!isObject(p) || !REPO.test(p.repo) || !Number.isSafeInteger(p.number) || p.number<1 ||
        !SHA.test(p.head) || typeof p.base !== 'string' || !p.base.trim() ||
        !Array.isArray(p.dependsOn) || p.dependsOn.length>20 ||
        p.dependsOn.some(x=>typeof x!=='string' || !REPO.test(x.split('#')[0]) ||
          !/^[1-9]\d*$/.test(x.split('#')[1]) || x.split('#').length!==2) ||
        !['open','merged'].includes(p.state) || typeof p.draft !== 'boolean') {
      fail('INVALID_PR_SPEC'); continue;
    }
    const k=key(p);
    if(byId.has(k)) { fail('DUPLICATE_PR'); continue; }
    if(p.dependsOn.includes(k) || new Set(p.dependsOn).size!==p.dependsOn.length)fail('INVALID_DEPENDENCY');
    byId.set(k,p); indegree.set(k,0);edges.set(k,[]);
  }
  for(const [k,p] of byId){
    if(p.state==='merged') continue;
    if (p.base !== 'main' && p.dependsOn.length > 0) fail('STACKED_REQUALIFICATION_REQUIRED');
    for(const dep of p.dependsOn){
      const parent=byId.get(dep);
      if(!parent){fail('DEPENDENCY_MISSING');continue;}
      if(parent.state==='open'){
        indegree.set(k,indegree.get(k)+1);edges.get(dep).push(k);
      }else if(!SHA.test(parent.mergeCommit||''))fail('MERGED_PARENT_UNVERIFIED');
    }
  }
  const queue=[...byId.keys()].filter(k=>indegree.get(k)===0).sort();
  const order=[];
  while(queue.length){
    const k=queue.shift();order.push(k);
    for(const child of edges.get(k)){indegree.set(child,indegree.get(child)-1);if(indegree.get(child)===0){queue.push(child);queue.sort();}}
  }
  if(order.length!==byId.size)fail('DEPENDENCY_CYCLE');
  const open=[...byId.values()].filter(x=>x.state==='open');
  if(open.length<minimumPRs)fail('INSUFFICIENT_OPEN_PRS');
  if(new Set(open.map(x=>x.repo)).size<minimumRepos)fail('INSUFFICIENT_REPOSITORIES');
  if(open.some(x=>x.draft))fail('DRAFT_PR_PRESENT');
  if(open.some(x=>x.base!=='main' && x.dependsOn.length===0))fail('UNDECLARED_STACKED_BASE');
  return {advisoryOnly:true, mergeAuthorized:false,
    candidateCount:open.length,repositoryCount:new Set(open.map(x=>x.repo)).size,
    order:order.filter(k=>byId.get(k)?.state==='open'),blockers};
}
