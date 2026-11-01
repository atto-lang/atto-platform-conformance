// Synthetic, deterministic reference oracle. This code is NOT an Oreslang
// backend, guest compiler, network proxy or independent parity evidence.
export function choose(input) {
  const {algorithm,weights,healthy,active,capacity,epoch,ordinal} = input;
  if (!['round_robin','weighted_round_robin','least_conn'].includes(algorithm) ||
      !Array.isArray(weights) || !Array.isArray(healthy) || !Array.isArray(active) ||
      weights.length<1 || weights.length>16 ||
      healthy.length!==weights.length || active.length!==weights.length ||
      !Number.isInteger(capacity) || capacity<1 || capacity>1024 ||
      !Number.isInteger(epoch) || epoch<=0 ||
      !Number.isInteger(ordinal) || ordinal<0) return null;
  for(let i=0;i<weights.length;i++) {
    if (!Number.isInteger(weights[i]) || weights[i]<1 || weights[i]>16 ||
        (algorithm==='round_robin' && weights[i]!==1) ||
        typeof healthy[i]!=='boolean' || !Number.isInteger(active[i]) ||
        active[i]<0 || active[i]>capacity) return null;
  }
  const eligible = i=>healthy[i] && active[i]<capacity;
  if (algorithm!=='least_conn') {
    let sum=0;
    for(let i=0;i<weights.length;i++) if(eligible(i)) sum+=weights[i];
    if(sum===0 || ordinal>=sum) return null;
    let pos=ordinal;
    for(let i=0;i<weights.length;i++) if(eligible(i)) {
      if(pos<weights[i]) return i;
      pos-=weights[i];
    }
    return null;
  }
  if(ordinal>=weights.length) return null;
  let best=-1;
  for(let i=0;i<weights.length;i++) {
    const index=(i+ordinal)%weights.length;
    if(!eligible(index)) continue;
    if(best===-1 || active[index]*weights[best] <
        active[best]*weights[index]) best=index;
  }
  return best===-1 ? null : best;
}

export function verifyVectors(payload) {
  if (!payload || payload.schema!=='oreslang.proxy_lb_selection.v1' ||
      payload.contract_id!=='proxy-lb-selection-v1' ||
      !Array.isArray(payload.scenarios) || payload.scenarios.length<20)
    throw Error('invalid LB vector registry');
  const ids=new Set();
  for (const vector of payload.scenarios) {
    if (typeof vector.id!=='string' || !/^[A-Z0-9_]{4,80}$/.test(vector.id) ||
        ids.has(vector.id)) throw Error('invalid or duplicated vector id');
    ids.add(vector.id);
    if (!Object.hasOwn(vector,'expected_index') ||
        (vector.expected_index!==null &&
         (!Number.isInteger(vector.expected_index) ||
          vector.expected_index<0 || vector.expected_index>=vector.weights.length)))
      throw Error('invalid vector expectation: '+vector.id);
    const actual=choose(vector);
    if(actual!==vector.expected_index)
      throw Error('synthetic oracle vector mismatch '+vector.id+
                  ': expected '+vector.expected_index+', got '+actual);
  }
  return {status:'SOURCE_ONLY_REFERENCE_PASS',vectors:ids.size,
    guest_execution:'NOT_EXECUTED',parity_certified:false};
}
