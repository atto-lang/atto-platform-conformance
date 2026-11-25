// Trusted-host integration reference ONLY. Not an authenticated network service.
import { BatchPersistenceSidecar, AdmissionError } from './sidecar.mjs';
import { encode_actor_id, decode_actor_id, actor_storage_key_from_bytes } from './identity.mjs';

const deny = code => { throw new AdmissionError(code); };

export class TrustedActorIdentitySidecar {
  #engine;
  #tenant;
  #lookup;
  #insert;
  constructor({ tenantId, ...options }) {
    this.#engine = new BatchPersistenceSidecar({ tenantId, ...options });
    this.#tenant = tenantId;
    this.#engine.db.exec(`CREATE TABLE IF NOT EXISTS actor_id_bindings (
      tenant TEXT NOT NULL,
      actor TEXT NOT NULL,
      canonical_actor_id BLOB NOT NULL,
      PRIMARY KEY(tenant,actor)
    )`);
    this.#lookup = this.#engine.db.prepare('SELECT canonical_actor_id FROM actor_id_bindings WHERE tenant=? AND actor=?');
    this.#insert = this.#engine.db.prepare('INSERT INTO actor_id_bindings VALUES(?,?,?)');
  }
  #binding(id, create) {
    // Canonicalize just once: untrusted mutable JS accessors must not change tenant or hash later.
    let bytes, actor, tenant;
    try {
      bytes = encode_actor_id(id);
      tenant = decode_actor_id(bytes).tenant;
      actor = actor_storage_key_from_bytes(bytes);
    } catch { deny('INVALID_ACTOR_ID'); }
    if (tenant !== this.#tenant) deny('WRONG_TENANT');
    if (create) {
      this.#engine.db.exec('BEGIN IMMEDIATE');
      try {
        const old = this.#lookup.get(this.#tenant, actor);
        if (old && !Buffer.from(old.canonical_actor_id).equals(bytes)) deny('ACTOR_ID_HASH_COLLISION');
        if (!old) this.#insert.run(this.#tenant, actor, bytes);
        this.#engine.db.exec('COMMIT');
      } catch (error) {
        try { this.#engine.db.exec('ROLLBACK'); } catch {}
        throw error;
      }
    } else {
      const old = this.#lookup.get(this.#tenant, actor);
      if (!old) deny('UNKNOWN_ACTOR_ID');
      if (!Buffer.from(old.canonical_actor_id).equals(bytes)) deny('ACTOR_ID_HASH_COLLISION');
    }
    return actor;
  }
  // Trusted host/directory ONLY; never expose to untrusted guest callers.
  activate({ id, epoch }) {
    const actor = this.#binding(id, true);
    this.#engine.grantEpoch({ tenantId:this.#tenant, actor, epoch });
    return { actor, epoch };
  }
  enqueue({ id, stateName, opId, epoch, expectedVersion, kind='snapshot', schemaVersion=1, payload }) {
    const actor = this.#binding(id, false);
    return this.#engine.enqueue({ tenantId:this.#tenant, actor, stateName, opId,
      epoch, expectedVersion, kind, schemaVersion, payload });
  }
  flush() { return this.#engine.flush(); }
  load({ id, stateName }) {
    const actor = this.#binding(id, false);
    return this.#engine.load({ tenantId:this.#tenant, actor, stateName });
  }
  close() { this.#engine.close(); }
}
