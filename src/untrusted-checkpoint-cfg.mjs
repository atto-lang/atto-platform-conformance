/**
 * Source-free model of a post-optimization, untrusted guest CFG admission gate.
 * NOT a compiler pass: only trusted compiler IR may supply `fuelCharge` and
 * `postCommit` evidence. A guest-provided JSON flag is NOT authorization.
 *
 * Every reachable cycle must cross an *unavoidable* hard-fuel charge, not
 * merely a sampled soft-fairness / `rt cooperate` poll. Remove hard-fuel
 * nodes, then reject if any reachable cycle remains. Direct/indirect call
 * edges form one conservative interprocedural graph to expose recursion.
 */
export function verifyUntrustedCheckpointCFG(graph) {
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)
      || !Array.isArray(graph.blocks) || typeof graph.entry !== 'string'
      || graph.entry.length === 0 || graph.blocks.length === 0
      || graph.blocks.length > 4096) {
    throw new TypeError('invalid checkpoint control-flow graph');
  }
  const blocks = new Map();
  let edgeCount = 0;
  for (const block of graph.blocks) {
    if (!block || typeof block !== 'object' || Array.isArray(block)
        || typeof block.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(block.id)
        || blocks.has(block.id) || !Array.isArray(block.next)
        || (block.calls !== undefined && !Array.isArray(block.calls))
        || (block.indirectTargets !== undefined && !Array.isArray(block.indirectTargets))
        || (block.indirectCall !== undefined && typeof block.indirectCall !== 'boolean')
        || (block.fuelCharge !== undefined && typeof block.fuelCharge !== 'boolean')
        || (block.postCommit !== undefined && typeof block.postCommit !== 'boolean')
        || (block.softPoll !== undefined && typeof block.softPoll !== 'boolean')
        || (block.foreign !== undefined && !['bounded','revocable','unisolated'].includes(block.foreign))
        || (block.revocationBoundMs !== undefined
            && (!Number.isSafeInteger(block.revocationBoundMs)
                || block.revocationBoundMs <= 0))) {
      throw new TypeError('invalid checkpoint block');
    }
    const links = [...block.next, ...(block.calls ?? []), ...(block.indirectTargets ?? [])];
    if (links.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(id))) {
      throw new TypeError('invalid checkpoint edge');
    }
    edgeCount += links.length;
    if (edgeCount > 16384) throw new TypeError('checkpoint edge budget exceeded');
    blocks.set(block.id, { ...block, links });
  }
  if (!blocks.has(graph.entry)) throw new TypeError('missing CFG entry');
  for (const block of blocks.values()) {
    if (block.links.some(id => !blocks.has(id))) throw new TypeError('unresolved CFG edge');
  }

  const reject = (reason, block, cycle) => ({decision:'REJECT',reason,
    ...(block === undefined ? {} : {block}), ...(cycle === undefined ? {} : {cycle})});
  // Compute reachability on the original graph, BEFORE removing hard-fuel
  // nodes; otherwise a metered entry can hide an unmetered downstream cycle.
  const reachable = new Set([graph.entry]);
  const queue = [graph.entry];
  for (let cursor = 0; cursor < queue.length; ++cursor) {
    const id = queue[cursor];
    for (const next of blocks.get(id).links) {
      if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
    }
  }
  for (const id of queue) {
    const b = blocks.get(id);
    if (b.indirectCall && (!b.indirectTargets || !b.indirectTargets.length))
      return reject('unresolved-indirect-call',id);
    if (b.foreign === 'unisolated') return reject('unisolated-foreign-call',id);
    if (b.foreign === 'revocable' && b.revocationBoundMs === undefined)
      return reject('foreign-revocation-not-bounded',id);
    if (b.fuelCharge && b.postCommit !== true)
      return reject('fuel-charge-not-post-commit',id);
  }

  // Each cycle in a CFG without hard-fuel nodes is an executable loop or
  // recursion path that may bypass the hard tenant quota. Iterative DFS
  // avoids stack overflow when inspecting adversarially deep graphs.
  const eligible = id => reachable.has(id) && blocks.get(id).fuelCharge !== true;
  const color = new Map();
  for (const root of queue) {
    if (!eligible(root) || color.has(root)) continue;
    const stack = [{id:root,index:0}];
    const activeIndex = new Map([[root,0]]);
    color.set(root,1);
    while (stack.length) {
      const top = stack[stack.length-1];
      const links = blocks.get(top.id).links;
      if (top.index === links.length) {
        color.set(top.id,2);
        activeIndex.delete(top.id);
        stack.pop();
        continue;
      }
      const next = links[top.index++];
      if (!eligible(next)) continue;
      if (activeIndex.has(next)) {
        const path = stack.slice(activeIndex.get(next)).map(frame => frame.id);
        return reject('cycle-without-hard-fuel',next,[...path,next]);
      }
      if (!color.has(next)) {
        color.set(next,1);
        activeIndex.set(next,stack.length);
        stack.push({id:next,index:0});
      }
    }
  }
  return {decision:'ADMIT',reason:'every-reachable-cycle-is-hard-fuel-metered',
    reachableBlocks:reachable.size};
}
