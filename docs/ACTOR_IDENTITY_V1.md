# ActorId v1: durable actor identity and persistence keys

**Status: PROPOSED / HOST-REFERENCE ONLY.** Applies to Java, LLVM, .NET, Wasm, and Forge. Cranelift is an independent target. This document does not claim implemented Oreslang guest syntax, live actor activation, authorization, or parity.

## Identity decision

A virtual actor is identified by `(tenant, namespace, actor_type, key)`. Tenant is selected by the authenticated host, **never trusted from guest input**. Namespace and actor type IDs are durable, explicit registrations independent of source class names, compiler backend, physical node, and storage provider. Renaming a source class must preserve the registered type ID, or invoke an explicit alias/migration. Schema version is **not** part of ActorId; it belongs to each named persistent state record.

Key is a **tagged** value, never an untyped string: UTF-8 string, canonical lowercase UUID (UUIDv7 preferred for newly generated keys, v4 allowed), u64, i64, or a 2–8-element flat compound key. A string `"42"`, u64 `42`, and i64 `42` are different identities. Do not generate a new UUID on each reactivation or retry; allocate once and retain it. For natural domain keys such as `customer-42`, prefer the existing business key to a redundant UUID.

An `ActorRef<T>` is a serializable logical reference; it is **not** a security capability. Tenant access must be authenticated and authorized on each ingress/delivery. Existing `spawn` semantics remain ephemeral; virtual activation is a separate API requiring compiler agreement. `ActivationId` is short-lived and not included in identity. A provider-enforced monotonic activation epoch is required for fencing: a random UUID alone does not prevent stale writers.

A durable `StateId` is ActorId + a *separate* canonical named slot, with its own provider/schema/version. All slots of one actor should normally route through the same actor-ordered persistence partition; an independent slot partition must explicitly retain cross-slot ordering constraints.

## Canonical binary representation (reference v1)

```
bytes:     4f 41 49 44 01   # ASCII OAID; protocol version 1
tenant:    u16_be(byte_length) || canonical UTF-8
namespace: u16_be(byte_length) || canonical UTF-8
type_id:   u16_be(byte_length) || canonical UTF-8
key:       tag:u8 || tagged payload
```

Tags: `01` = string + u16_be byte length; `02` = UUID 16 raw bytes; `03` = u64 big endian; `04` = i64 signed two's-complement big endian; `05` = compound count:u8 followed by tagged atomic keys (2–8 elements, no nested compound). No trailing bytes or alternate encodings allowed. Strings must be nonempty Unicode NFC, contain no ASCII control/DEL or unpaired surrogate, and have bounded UTF-8 sizes: tenant, namespace, type 128 bytes each; a string key 256 bytes; overall serialized ActorId <= 1024 bytes. Numbers outside exact signed/unsigned 64-bit limits are rejected. Decoders must reject truncated, invalid UTF-8, noncanonical and unknown-version messages.

Reference exports `encode_actor_id`, `decode_actor_id`, `actor_ref_token`, `parse_actor_ref_token`, `actor_id_hash` and `actor_storage_key` in `../reference/persistence-sidecar/identity.mjs`. The reversible `oa1_` base64url token carries canonical bytes. The constant-length storage lookup key `oa1h_` is base64url(SHA-256(ASCII `ORESLANG_ACTOR_ID_V1\0` || canonical bytes)); this hash is **not** a tenant credential. Production storage should additionally retain the canonical identity tuple to detect any hash collision, protect authoritative tenant boundaries, and enable migrations. Shard placement must be a separately versioned consistent-hash/rendezvous mapping of a stable digest, **not** an ActorId component; changing shard counts must not change identity.

### Golden vector

```json
{"tenant":"tenant-a","namespace":"commerce","actor_type":"shopping_cart",
 "key":{"kind":"string","value":"customer-42"}}
```

Canonical hex: `4f41494401000874656e616e742d610008636f6d6d65726365000d73686f7070696e675f6361727401000b637573746f6d65722d3432`

SHA-256 (domain-separated): `b2dbb6759eda51e096106dd0a0c9b87b29ba03d9df9008650152674bdd5f3498`

Java, LLVM, .NET, WASM, Forge, and Cranelift must produce **exactly these bytes**, and additional vectors for all key tags, before announcing wire-format parity. Do not collapse signed/unsigned numbers or normalize distinct actor names silently.

## Integration with batched sidecars

The current SQLite sidecar takes a trusted `actor` string and separate `tenantId`. A trusted broker can calculate `actor_storage_key(id)`, **verify id.tenant matches the authenticated tenant**, and pass the resulting key to the existing sidecar model; tenants must not select arbitrary hash identities or grant epochs. The model does not yet enforce those checks itself and therefore is not a secure multi-tenant host implementation. The sidecar should eventually persist canonical identity fields separately and enforce permissions independently of supplied strings.

Writes are per `(ActorId, state_name)` and include operation ID, activation epoch, expected version, payload and schema. The durable ACK follows provider commit; queued admission is not durable. Stale activation rejection precedes operation deduplication. Migration must fence the old epoch at the authoritative provider before the new actor's externally visible durable writes. Avoid raw actor-heap pointers and backend-specific object layouts in persisted envelopes.

## Mandatory acceptance cases

- ID01–ID06: every key tag roundtrips; invalid formats and Unicode rejected; distinct key tags/type/tenant/namespace never collide in fixtures; exact golden bytes/hash; stable token across process restarts.
- ID07: authenticated tenant binding and forged ActorRef rejection; a serialized ref never acts as authority.
- ID08: rename/alias migration without accidental state re-key, and explicit behavior for changed registered type ID.
- ID09: activation failure/restart preserves ActorId while epoch increases; stale writer and stale dedupe denied.
- ID10: 1k distinct logical actor IDs batched; per-slot CAS, operation dedupe and close/reopen state recovery; no false committed receipt from queue admission.
- ID11: simulated hash collision must be detected by canonical identity comparison; shards rebalance without changing identity.
- ID12: actual checked and executed source guests plus negative security tests on all backends using pinned revision SHA and executable provenance.

The included Node reference tests cover only parts of ID01–ID06. **ID07–ID12 and all source-guest cross-backend gates are NOT_EXECUTED.** See [persistence design](./PERSISTENCE_SIDECARS_RFC.md) and [virtual actor design](./VIRTUAL_ACTORS_VM_ISOLATES_RFC.md).