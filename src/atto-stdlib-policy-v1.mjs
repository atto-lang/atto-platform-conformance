// Fail-closed source-only evidence: not a compiler, runtime or receipt attestor.
const HEAD = '93180c85eec1accade4f5d459c962c8b3e44e8bc';
const TREE = '79c546c293e3b6b1c2d4f52685299236432f3779';
const PARENT = '47ce96d3231e267e8989734dbb50606e9057fc54';
const POLICIES = Object.freeze({
  layout_policy:['47624305881b1578c71f14748e847901ab7d9a0e','DataOrientedLayout'],
  region_policy:['a4b14f14251634d7131e2abb0c4790be9171cda1','DopRegionSchedule'],
  dense_index:['f4833c2e8889632bf5e1e29927869cc2ba316327','ManagedReferencePolicy'],
  actor_result_policy:['412c47f394e990d8b2cd88fbd4799353105f81e2','ActorResults'],
  task_parallel_policy:['d4f02ad4ea7289cc245117585c973df63ac4c43c','TaskMapParallel']
});
const BACKENDS = Object.freeze({
  java:'ores-truffle-oreslang/oreslang-source.java',
  llvm:'ores-truffle-oreslang/oreslang-source.llvm',
  net:'ores-truffle-oreslang/oreslang-source.net',
  wasm:'ores-truffle-oreslang/oreslang-source.wasm',
  forge:'ores-truffle-oreslang/oreslang-source.forge'
});
function check(ok, message) { if (!ok) throw Error(message); }
function shape(x, keys, where) {
  check(x !== null && typeof x === 'object' && !Array.isArray(x), where+' is not an object');
  check(JSON.stringify(Object.keys(x).sort()) === JSON.stringify([...keys].sort()), where+' keys mismatch');
}
export function inspectAttoStdlibPolicyV1(d) {
  shape(d,['schema','source','policies','backends','gates'],'manifest');
  check(d.schema === 'attolang.stdlib-portable-policy.v1','bad schema');
  shape(d.source,['repository','pr','head_sha','tree_sha','parent_pr','parent_head_sha'],'source');
  check(d.source.repository === BACKENDS.java && d.source.pr === 2553 &&
        d.source.parent_pr === 2544 && d.source.head_sha === HEAD &&
        d.source.tree_sha === TREE && d.source.parent_head_sha === PARENT,
        'source head/tree/PR provenance mismatch');
  check(Array.isArray(d.policies) && d.policies.length === 5,'expected five policy modules');
  const seen=new Set();
  for(const p of d.policies) {
    shape(p,['id','source_path','source_blob_sha','guest_fixture','java_oracle'],'policy');
    check(Object.hasOwn(POLICIES,p.id) && !seen.has(p.id),'duplicate or unknown module');
    const [sha,oracle]=POLICIES[p.id];
    check(p.source_blob_sha === sha && p.java_oracle === oracle &&
      p.source_path === 'stdlib/'+p.id+'.atto' &&
      p.guest_fixture === 'src/test/resources/stdlib-parity/portable-java-policy/'+p.id+'.atto',
      'module source or guest fixture mismatch');
    seen.add(p.id);
  }
  const backSeen=new Set();
  check(Array.isArray(d.backends) && d.backends.length === 5,'expected five backend slots');
  for(const b of d.backends) {
    shape(b,['id','repository','status','runner_id','executed_steps','compiler_receipt','guest_receipt'],'backend');
    check(Object.hasOwn(BACKENDS,b.id) && !backSeen.has(b.id),'unknown or duplicate backend');
    check(b.repository === BACKENDS[b.id],'backend repository substitution');
    check(b.status === (b.id === 'java' ? 'RUNNER_ADMISSION_FAILED' : 'NOT_EXECUTED'),
      'unverified backend cannot claim guest execution');
    check(b.runner_id === (b.id === 'java' ? 0 : null) && b.executed_steps === 0 &&
      b.compiler_receipt === null && b.guest_receipt === null, 'invented runner or guest evidence');
    backSeen.add(b.id);
  }
  shape(d.gates,['source_only','guest_executed','cross_backend_verified',
    'independent_review_approved','safe_to_merge'],'gates');
  check(d.gates.source_only === true && d.gates.guest_executed === false &&
    d.gates.cross_backend_verified === false && d.gates.independent_review_approved === false &&
    d.gates.safe_to_merge === false,'unearned promotion');
  return Object.freeze({evidence_class:'SOURCE_ONLY',module_count:5,backend_count:5,guest_executed:false});
}
