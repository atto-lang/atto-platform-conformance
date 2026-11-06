import test from 'node:test';import assert from 'node:assert/strict';
import {assessCoverage} from '../tools/audit-coverage-receipt-v1.mjs';
const base={org:'atto-lang',expectedRepos:['atto-lang/compiler','atto-lang/conformance'],days:['2026-11-06'],repositoryEnumerationComplete:true,
 partitions:[{repo:'atto-lang/compiler',day:'2026-11-06',total:1,seen:1,complete:true},{repo:'atto-lang/conformance',day:'2026-11-06',total:0,seen:0,complete:true}],
 prs:[{repository:'atto-lang/compiler',number:7,head:'a'.repeat(40),headVerified:true,state:'open',createdDay:'2026-11-06'}]};
const has=(r,code)=>r.gaps.some(x=>x.code===code);
test('fully accounted sample does not certify executions',()=>{const r=assessCoverage(base);assert.equal(r.state,'ACCOUNTED_NOT_CERTIFIED');assert.equal(r.executedTestsCertified,false);});
test('denies missing repository enumeration',()=>assert.ok(has(assessCoverage({...base,repositoryEnumerationComplete:false}),'REPOSITORY_LIST_INCOMPLETE')));
test('denies lost PR-day partition',()=>assert.ok(has(assessCoverage({...base,partitions:base.partitions.slice(0,1)}),'PARTITION_MISSING')));
test('denies 1000 search cap irrespective of observed count',()=>{const p={...base.partitions[0],seen:1000,total:1000,complete:true};assert.ok(has(assessCoverage({...base,partitions:[p,base.partitions[1]]}),'PARTITION_NOT_PROVEN'));});
test('rate-limit and permission failures are not hidden',()=>{for(const flag of ['rateLimited','permissionDenied','capHit','incompleteResults']){const p={...base.partitions[0],[flag]:true};assert.ok(has(assessCoverage({...base,partitions:[p,base.partitions[1]]}),'PARTITION_SEARCH_GAP'));}});
test('unverified PR HEAD fails even with complete partitions',()=>assert.ok(has(assessCoverage({...base,prs:[{...base.prs[0],headVerified:false}]}),'HEAD_UNVERIFIED')));
test('invalid SHA fails closed',()=>assert.ok(has(assessCoverage({...base,prs:[{...base.prs[0],head:'main'}]}),'HEAD_UNVERIFIED')));
test('duplicate PR ID fails closed',()=>assert.ok(has(assessCoverage({...base,prs:[...base.prs,base.prs[0]]}),'PR_DUPLICATED')));
test('duplicate partition fails closed',()=>assert.ok(has(assessCoverage({...base,partitions:[...base.partitions,base.partitions[0]]}),'PARTITION_DUPLICATED')));
test('extra out of scope partition rejected',()=>{const x={repo:'atto-lang/unknown',day:'2026-11-06',total:0,seen:0,complete:true};assert.ok(has(assessCoverage({...base,partitions:[...base.partitions,x]}),'OUT_OF_SCOPE_PARTITION'));});
test('counts must reconcile with unique enumerated PRs',()=>assert.ok(has(assessCoverage({...base,prs:[]}), 'PR_COUNT_MISMATCH')));
test('unknown repo scope cannot be silently counted',()=>assert.ok(has(assessCoverage({...base,expectedRepos:[]}), 'REPO_SCOPE_UNVERIFIED')));
test('empty valid PR day can be accounted without test proof',()=>{const r=assessCoverage({org:'atto-lang',expectedRepos:['atto-lang/conformance'],days:['2026-11-06'],repositoryEnumerationComplete:true,partitions:[base.partitions[1]],prs:[]});assert.equal(r.state,'ACCOUNTED_NOT_CERTIFIED');assert.equal(r.releaseAuthorized,false);});
