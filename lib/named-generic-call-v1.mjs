// Source-free binding reference. This is not a guest compiler or a parity receipt.
export const OMITTED = Symbol('omitted-optional-slot');
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
// A checked plan is an unforgeable source-free oracle capability, never runtime authority.
const CHECKED_CALL_PLANS = new WeakSet();
function reject(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}
function valid_name(name) { return typeof name === 'string' && IDENT.test(name); }
function valid_type(type) { return typeof type === 'string' && type.trim().length > 0; }
// This identity must be emitted by the compiler's resolved declaration registry,
// not assembled from user input. It includes package/module/version/visibility/generation.
function canonical_declaration_identity(identity) {
  if (typeof identity !== 'string' ||
      !/^[A-Za-z0-9_.:+/@#-]{1,512}$/.test(identity))
    reject('invalid-generic-declaration-identity');
  return identity;
}
function canonical_layout_metadata(keys, metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))
    reject('invalid-layout-metadata');
  const entries = Object.entries(metadata);
  if (entries.length > keys.length) reject('unknown-layout-metadata');
  for (const [key, value] of entries) {
    if (!keys.includes(key)) reject('unknown-layout-metadata');
    if (!(typeof value === 'string' ||
          typeof value === 'boolean' ||
          (typeof value === 'number' && Number.isSafeInteger(value))))
      reject('invalid-layout-metadata');
  }
  return entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

// A generic default is {type: 'int'} or {ref: 'EarlierFormal'}.
// "metadataKeys" is a distinct, declaration-owned namespace; collisions are errors.
export function bind_generic_args(formals, actuals, { inferred = {}, metadataKeys = [], declarationIdentity, layoutMetadata = {} } = {}) {
  if (!Array.isArray(formals) || !Array.isArray(actuals) ||
      formals.length > 64 || actuals.length > 64) reject('generic-budget');
  const names = formals.map(f => f.name);
  if (names.some(n => !valid_name(n)) || new Set(names).size !== names.length)
    reject('invalid-generic-declaration');
  if (!Array.isArray(metadataKeys) || metadataKeys.some(k => !valid_name(k)) ||
      new Set(metadataKeys).size !== metadataKeys.length)
    reject('invalid-metadata-schema');
  if (names.some(n => metadataKeys.includes(n))) reject('generic-metadata-collision');
  const nominalIdentity = canonical_declaration_identity(declarationIdentity);
  const canonicalLayout = canonical_layout_metadata(metadataKeys, layoutMetadata);
  if (!inferred || typeof inferred !== 'object' || Array.isArray(inferred))
    reject('invalid-inferred-generic');
  for (let i = 0; i < formals.length; i++) {
    const d = formals[i].default;
    if (d === undefined) continue;
    if (!d || typeof d !== 'object' ||
        (Object.keys(d).length !== 1) ||
        (d.type !== undefined ? !valid_type(d.type) :
         d.ref !== undefined ? !names.slice(0, i).includes(d.ref) : true))
      reject('invalid-generic-default');
  }
  const slots = new Array(formals.length);
  const occupied = new Set();
  const sourceToFormal = [];
  let named = false, positional = 0;
  for (const item of actuals) {
    if (!item || !valid_type(item.type)) reject('invalid-generic-argument');
    const hasName = item.name !== null && item.name !== undefined;
    let slot;
    if (hasName) {
      named = true;
      if (!valid_name(item.name) || !names.includes(item.name)) reject('unknown-generic-label');
      slot = names.indexOf(item.name);
    } else {
      if (named) reject('generic-positional-after-named');
      slot = positional++;
    }
    if (slot >= names.length) reject('excess-generic-arguments');
    if (occupied.has(slot)) reject('duplicate-generic-slot');
    occupied.add(slot);
    slots[slot] = item.type;
    sourceToFormal.push(slot);
  }
  for (const [name, type] of Object.entries(inferred)) {
    const slot = names.indexOf(name);
    if (slot < 0 || !valid_type(type)) reject('invalid-inferred-generic');
    if (occupied.has(slot) && slots[slot] !== type) reject('generic-inference-conflict');
    slots[slot] = type;
    occupied.add(slot);
  }
  for (let i = 0; i < formals.length; i++) {
    if (occupied.has(i)) continue;
    const d = formals[i].default;
    if (d === undefined) reject('missing-generic-argument');
    const value = d.type !== undefined ? d.type : slots[names.indexOf(d.ref)];
    if (!valid_type(value)) reject('unbound-generic-default');
    slots[i] = value;
    occupied.add(i);
  }
  return Object.freeze({
    ordered: Object.freeze(slots),
    sourceToFormal: Object.freeze(sourceToFormal),
    specializationKey: JSON.stringify([nominalIdentity, slots, canonicalLayout])
  });
}

// Emits a plan only. Compiler type/ownership/effect checks must run before execution.
export function plan_named_call(formals, actuals) {
  if (!Array.isArray(formals) || !Array.isArray(actuals) ||
      formals.length > 1024 || actuals.length > 1024) reject('call-budget');
  const names = formals.map(f => f.name);
  if (names.some(n => !valid_name(n)) || new Set(names).size !== names.length)
    reject('invalid-callable-formals');
  const slotToSource = Array(formals.length).fill(-1);
  const sourceToFormal = [];
  let named = false, positional = 0;
  for (let i = 0; i < actuals.length; i++) {
    const item = actuals[i];
    if (!item || item.spread || item.assign ||
        (item.kind !== undefined && item.kind !== 'value')) reject('unsupported-call-item');
    const hasName = item.name !== null && item.name !== undefined;
    let slot;
    if (hasName) {
      named = true;
      if (!valid_name(item.name) || !names.includes(item.name)) reject('unknown-value-label');
      slot = names.indexOf(item.name);
    } else {
      if (named) reject('value-positional-after-named');
      slot = positional++;
    }
    if (slot >= names.length) reject('excess-value-arguments');
    if (slotToSource[slot] !== -1) reject('duplicate-value-slot');
    slotToSource[slot] = i;
    sourceToFormal.push(slot);
  }
  for (let i = 0; i < formals.length; i++)
    if (slotToSource[i] === -1 && !formals[i].optional) reject('missing-required-value');
  const plan = Object.freeze({
    slotToSource: Object.freeze(slotToSource),
    sourceToFormal: Object.freeze(sourceToFormal)
  });
  CHECKED_CALL_PLANS.add(plan);
  return plan;
}

// Independent oracle: receiver then actual thunks in lexical source order.
// The compiler still has to preserve type, ownership, effect and cleanup checks.
export function evaluate_named_call(plan, thunks, receiver = () => undefined) {
  if (!CHECKED_CALL_PLANS.has(plan) || !Array.isArray(plan.sourceToFormal) || !Array.isArray(thunks) ||
      plan.sourceToFormal.length !== thunks.length ||
      typeof receiver !== 'function' || thunks.some(t => typeof t !== 'function'))
    reject('invalid-execution-plan');
  // Recheck a supplied plan *before* running the receiver or any side effects.
  // Production lowering must consume an identity-bound checked compiler proof.
  if (!Array.isArray(plan.slotToSource) || plan.slotToSource.length > 1024 ||
      plan.sourceToFormal.length > 1024) reject('invalid-execution-plan');
  const used = new Set();
  for (let i = 0; i < plan.sourceToFormal.length; i++) {
    const slot = plan.sourceToFormal[i];
    if (!Number.isInteger(slot) || slot < 0 || slot >= plan.slotToSource.length ||
        used.has(slot) || plan.slotToSource[slot] !== i) reject('invalid-execution-plan');
    used.add(slot);
  }
  for (let slot = 0; slot < plan.slotToSource.length; slot++) {
    const i = plan.slotToSource[slot];
    if (!Number.isInteger(i) || i < -1 || i >= thunks.length ||
        (i >= 0 && plan.sourceToFormal[i] !== slot)) reject('invalid-execution-plan');
  }
  receiver();
  const temporaries = thunks.map(thunk => thunk());
  return plan.slotToSource.map(i => i < 0 ? OMITTED : temporaries[i]);
}
