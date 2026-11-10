// Executable host-side REFERENCE MODEL ONLY: not an Oreslang guest actor/runtime.
// Node 22+ built-in SQLite, WAL and synchronous=FULL. For trusted single-writer tests.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

export class AdmissionError extends Error {
  constructor(code) { super(code); this.name = 'AdmissionError'; this.code = code; }
}
const fail = (code) => { throw new AdmissionError(code); };
const ident = (s) => typeof s === 'string' && s.length > 0 && s.length <= 128 &&
  s === s.normalize('NFC') &&
  !/[\x00-\x1f\x7f\uD800-\uDFFF]/u.test(s) && Buffer.byteLength(s, 'utf8') <= 128;
const uint = (n) => Number.isSafeInteger(n) && n >= 0;
const key = (e) => JSON.stringify([e.actor, e.stateName, e.opId]);
const digest = (e) => createHash('sha256').update(JSON.stringify([
  e.tenantId,e.actor,e.stateName,e.opId,e.epoch,e.expectedVersion,
  e.kind,e.schemaVersion,e.payload.toString('base64')
])).digest('hex');

export class BatchPersistenceSidecar {
  constructor({ path, tenantId, maxQueuedBytes = 4 * 1024 * 1024,
    maxPayloadBytes = 64 * 1024, maxQueuedEntries = 4096, maxBatchEntries = 256, maxBatchBytes = 1024 * 1024 }) {
    if (!ident(tenantId) || !ident(path)) fail('INVALID_CONFIG');
    if (![maxQueuedBytes,maxPayloadBytes,maxQueuedEntries,maxBatchEntries,maxBatchBytes].every(n => uint(n) && n > 0)) fail('INVALID_CONFIG');
    this.tenantId = tenantId;
    this.maxQueuedBytes = maxQueuedBytes;
    this.maxPayloadBytes = maxPayloadBytes;
    this.maxQueuedEntries = maxQueuedEntries;
    this.maxBatchEntries = maxBatchEntries;
    this.maxBatchBytes = maxBatchBytes;
    this.queuedBytes = 0;
    this.queue = [];
    this.pending = new Map();
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS fences (tenant TEXT NOT NULL, actor TEXT NOT NULL,
        epoch INTEGER NOT NULL, PRIMARY KEY(tenant,actor));
      CREATE TABLE IF NOT EXISTS heads (tenant TEXT NOT NULL, actor TEXT NOT NULL,
        state_name TEXT NOT NULL, version INTEGER NOT NULL,
        PRIMARY KEY(tenant,actor,state_name));
      CREATE TABLE IF NOT EXISTS snapshots (tenant TEXT NOT NULL, actor TEXT NOT NULL,
        state_name TEXT NOT NULL, version INTEGER NOT NULL, schema_version INTEGER NOT NULL,
        payload BLOB NOT NULL, PRIMARY KEY(tenant,actor,state_name));
      CREATE TABLE IF NOT EXISTS events (tenant TEXT NOT NULL, actor TEXT NOT NULL,
        state_name TEXT NOT NULL, version INTEGER NOT NULL, schema_version INTEGER NOT NULL,
        op_id TEXT NOT NULL, payload BLOB NOT NULL,
        PRIMARY KEY(tenant,actor,state_name,version));
      CREATE TABLE IF NOT EXISTS operations (tenant TEXT NOT NULL, actor TEXT NOT NULL,
        state_name TEXT NOT NULL, op_id TEXT NOT NULL, digest TEXT NOT NULL,
        version INTEGER NOT NULL, kind TEXT NOT NULL,
        PRIMARY KEY(tenant,actor,state_name,op_id));`);
    this.getFence = this.db.prepare('SELECT epoch FROM fences WHERE tenant=? AND actor=?');
    this.getOp = this.db.prepare('SELECT digest, version, kind FROM operations WHERE tenant=? AND actor=? AND state_name=? AND op_id=?');
    this.getHead = this.db.prepare('SELECT version FROM heads WHERE tenant=? AND actor=? AND state_name=?');
    this.putHead = this.db.prepare('INSERT INTO heads VALUES(?,?,?,?) ON CONFLICT(tenant,actor,state_name) DO UPDATE SET version=excluded.version');
    this.putSnapshot = this.db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,?) ON CONFLICT(tenant,actor,state_name) DO UPDATE SET version=excluded.version, schema_version=excluded.schema_version, payload=excluded.payload');
    this.putEvent = this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)');
    this.putOp = this.db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?,?)');
  }
  // TRUSTED CONTROL PLANE ONLY: never expose this to a guest actor.
  grantEpoch({ tenantId, actor, epoch }) {
    if (tenantId !== this.tenantId) fail('WRONG_TENANT');
    if (!ident(actor) || !uint(epoch) || epoch < 1) fail('INVALID_EPOCH');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.getFence.get(tenantId, actor);
      if (old && epoch < old.epoch) fail('STALE_EPOCH');
      if (!old) this.db.prepare('INSERT INTO fences VALUES(?,?,?)').run(tenantId, actor, epoch);
      else if (epoch > old.epoch) this.db.prepare('UPDATE fences SET epoch=? WHERE tenant=? AND actor=?').run(epoch,tenantId,actor);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  enqueue(input) {
    const {tenantId,actor,stateName,opId,epoch,expectedVersion,kind='snapshot',schemaVersion=1,payload} = input;
    if (tenantId !== this.tenantId) fail('WRONG_TENANT');
    if (![actor,stateName,opId].every(ident) || !uint(epoch) || epoch < 1 ||
      !uint(expectedVersion) || !uint(schemaVersion) || schemaVersion < 1 ||
      !['snapshot','event'].includes(kind) || !Buffer.isBuffer(payload)) fail('INVALID_WRITE');
    if (payload.byteLength > this.maxPayloadBytes || payload.byteLength > this.maxBatchBytes) fail('PAYLOAD_TOO_LARGE');
    // Snapshot bytes are copied on admission so callers cannot mutate an enqueued write.
    const e = {tenantId,actor,stateName,opId,epoch,expectedVersion,kind,schemaVersion,payload:Buffer.from(payload)};
    const hash = digest(e), k = key(e);
    // Fence before any dedup receipt, including a retry of an already committed operation.
    if (this.getFence.get(tenantId,actor)?.epoch !== epoch) fail('STALE_EPOCH');
    const existing = this.getOp.get(tenantId,actor,stateName,opId);
    if (existing) {
      if (existing.digest !== hash) fail('OP_ID_CONFLICT');
      return {status:'committed',durable:true,duplicate:true,version:existing.version};
    }
    const queued = this.pending.get(k);
    if (queued) {
      if (queued.hash !== hash) fail('OP_ID_CONFLICT');
      return {status:'admitted',durable:false,duplicate:true};
    }
    // Reserve payload and all variable-length identifier bytes; 128 covers a fixed
    // minimum envelope charge, not a claim to measure all JS heap overhead.
    const charge = 128 + e.payload.length + Buffer.byteLength(e.actor) +
      Buffer.byteLength(e.stateName) + Buffer.byteLength(e.opId);
    if (this.queue.length >= this.maxQueuedEntries ||
      charge > this.maxQueuedBytes - this.queuedBytes) fail('BACKPRESSURE');
    this.queue.push({e,hash,k,charge});
    this.pending.set(k, {hash});
    this.queuedBytes += charge;
    return {status:'admitted',durable:false,duplicate:false};
  }
  flush() {
    let bytes=0, count=0;
    while (count < this.queue.length && count < this.maxBatchEntries &&
        bytes + this.queue[count].e.payload.length <= this.maxBatchBytes) {
      bytes += this.queue[count].e.payload.length; count++;
    }
    if (count === 0) return [];
    const batch=this.queue.slice(0,count), results=[];
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const {e,hash} of batch) {
        const {tenantId:t,actor:a,stateName:s,opId:o}=e;
        if (this.getFence.get(t,a)?.epoch !== e.epoch) {
          results.push({opId:o,status:'rejected',durable:false,code:'STALE_EPOCH'}); continue;
        }
        const prior=this.getOp.get(t,a,s,o);
        if (prior) {
          results.push(prior.digest===hash
            ? {opId:o,status:'committed',durable:true,duplicate:true,version:prior.version}
            : {opId:o,status:'rejected',durable:false,code:'OP_ID_CONFLICT'});
          continue;
        }
        const version=this.getHead.get(t,a,s)?.version??0;
        if (version!==e.expectedVersion) {
          results.push({opId:o,status:'rejected',durable:false,code:'VERSION_CONFLICT'}); continue;
        }
        if (version===Number.MAX_SAFE_INTEGER) {
          results.push({opId:o,status:'rejected',durable:false,code:'VERSION_EXHAUSTED'}); continue;
        }
        const next=version+1;
        this.putHead.run(t,a,s,next);
        if (e.kind==='snapshot') this.putSnapshot.run(t,a,s,next,e.schemaVersion,e.payload);
        else this.putEvent.run(t,a,s,next,e.schemaVersion,o,e.payload);
        this.putOp.run(t,a,s,o,hash,next,e.kind);
        results.push({opId:o,status:'committed',durable:true,duplicate:false,version:next});
      }
      this.db.exec('COMMIT');
    } catch (e) {
      // Unknown COMMIT outcomes must be resolved by op_id on retry.
      try { this.db.exec('ROLLBACK'); } catch {}
      throw new AdmissionError('OUTCOME_UNKNOWN');
    }
    this.queue.splice(0,count);
    for (const {k,charge} of batch) { this.pending.delete(k); this.queuedBytes -= charge; }
    return results;
  }
  // Trusted host-only commit witness: never treat a caller-supplied ACK as storage proof.
  // An operation's persisted digest, epoch and version must match the original queued bytes.
  verifyCommit(e) {
    const {tenantId,actor,stateName,opId,epoch,expectedVersion,kind,schemaVersion,payload} = e ?? {};
    if (tenantId !== this.tenantId) fail('WRONG_TENANT');
    if (![actor,stateName,opId].every(ident) || !uint(epoch) || epoch < 1 ||
        !uint(expectedVersion) || !uint(schemaVersion) || schemaVersion < 1 ||
        !['snapshot','event'].includes(kind) || !Buffer.isBuffer(payload)) fail('INVALID_COMMIT_PROOF');
    if (this.getFence.get(tenantId,actor)?.epoch !== epoch) fail('STALE_EPOCH');
    const op=this.getOp.get(tenantId,actor,stateName,opId);
    if (!op) return null;
    if (op.digest !== digest(e) || op.kind !== kind || op.version !== expectedVersion + 1)
      fail('COMMIT_MISMATCH');
    return {opId,status:'committed',durable:true,version:op.version};
  }
  // TRUSTED CONTROL PLANE ONLY. Epoch check, snapshot and ordered events
  // must observe one consistent SQLite read transaction across processes.
  loadFenced({tenantId,actor,stateName,epoch}) {
    if (tenantId !== this.tenantId) fail('WRONG_TENANT');
    if (!ident(actor) || !ident(stateName) || !uint(epoch) || epoch < 1)
      fail('INVALID_READ');
    this.db.exec('BEGIN');
    try {
      if (this.getFence.get(tenantId,actor)?.epoch !== epoch) fail('STALE_EPOCH');
      const restored = this.#readState(tenantId,actor,stateName);
      this.db.exec('COMMIT');
      return restored;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }
  // Privileged host inspection path; guest actor reactivation uses loadFenced.
  load({tenantId,actor,stateName}) {
    if (tenantId !== this.tenantId) fail('WRONG_TENANT');
    if (![actor,stateName].every(ident)) fail('INVALID_READ');
    this.db.exec('BEGIN');
    try {
      const restored = this.#readState(tenantId,actor,stateName);
      this.db.exec('COMMIT');
      return restored;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }
  // Streaming, bounded read; rejects incomplete journals before state exposure.
  #readState(tenantId, actor, stateName) {
    const version = this.getHead.get(tenantId,actor,stateName)?.version ?? 0;
    if (!uint(version)) fail('INCOMPLETE_ACTOR_JOURNAL');
    const row = this.db.prepare(
      'SELECT version,schema_version,length(payload) AS size,substr(payload,1,1048577) AS payload FROM snapshots WHERE tenant=? AND actor=? AND state_name=?'
    ).get(tenantId,actor,stateName);
    let snapshot = null, since = 0;
    if (row) {
      if (!uint(row.version) || row.version < 1 || row.version > version ||
          !uint(row.schema_version) || row.schema_version < 1 ||
          !uint(row.size) || row.size > 1048576 ||
          !(row.payload instanceof Uint8Array) || row.payload.byteLength !== row.size)
        fail('INVALID_ACTOR_SNAPSHOT');
      since = row.version;
      snapshot = {version:row.version,schemaVersion:row.schema_version,payload:Buffer.from(row.payload)};
    }
    if (version - since > 10000) fail('ACTOR_JOURNAL_REPLAY_LIMIT');
    const events = [];
    let replayBytes = 0, expected = since + 1;
    const statement = this.db.prepare(
      'SELECT version,schema_version,op_id,length(payload) AS size,substr(payload,1,1048577) AS payload FROM events WHERE tenant=? AND actor=? AND state_name=? AND version>? ORDER BY version ASC'
    );
    for (const e of statement.iterate(tenantId,actor,stateName,since)) {
      if (e.version !== expected) fail('JOURNAL_GAP');
      if (!uint(e.schema_version) || e.schema_version < 1 ||
          !uint(e.size) || e.size > 1048576 || e.size > 16777216 - replayBytes ||
          !(e.payload instanceof Uint8Array) || e.payload.byteLength !== e.size)
        fail('INVALID_ACTOR_EVENT');
      if (events.length === 10000) fail('ACTOR_JOURNAL_REPLAY_LIMIT');
      replayBytes += e.size;
      events.push({version:e.version,schemaVersion:e.schema_version,
        opId:e.op_id,payload:Buffer.from(e.payload)});
      expected++;
    }
    if (expected !== version + 1) fail('JOURNAL_GAP');
    return {version,snapshot,events};
  }
  close() { this.db.close(); }
}
