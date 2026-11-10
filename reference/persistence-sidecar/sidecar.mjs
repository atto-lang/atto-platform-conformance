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
const hash_bytes = (b) => createHash('sha256').update(b).digest('hex');
const events_digest = (schemaVersion, events) => hash_bytes(Buffer.from(JSON.stringify([
  schemaVersion,events.map(b=>b.toString('base64'))
])));
const hash_command_attempt = (e) => hash_bytes(Buffer.from(JSON.stringify([
  e.tenantId,e.actor,e.stateName,e.opId,e.epoch,e.expectedVersion,
  e.schemaVersion,e.commandHash,e.events.map(b=>b.toString('base64')),
  e.resultBytes.toString('base64')
])));
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
        payload BLOB NOT NULL, payload_hash TEXT, operation_digest TEXT,
        PRIMARY KEY(tenant,actor,state_name));
      CREATE TABLE IF NOT EXISTS events (tenant TEXT NOT NULL, actor TEXT NOT NULL,
        state_name TEXT NOT NULL, version INTEGER NOT NULL, schema_version INTEGER NOT NULL,
        op_id TEXT NOT NULL, payload BLOB NOT NULL,
        PRIMARY KEY(tenant,actor,state_name,version));
      CREATE TABLE IF NOT EXISTS operations (tenant TEXT NOT NULL, actor TEXT NOT NULL,
        state_name TEXT NOT NULL, op_id TEXT NOT NULL, digest TEXT NOT NULL,
        version INTEGER NOT NULL, kind TEXT NOT NULL, payload_hash TEXT,
        PRIMARY KEY(tenant,actor,state_name,op_id));
      CREATE TABLE IF NOT EXISTS command_commits (
        tenant TEXT NOT NULL, actor TEXT NOT NULL, state_name TEXT NOT NULL,
        op_id TEXT NOT NULL, command_hash TEXT NOT NULL,
        first_version INTEGER NOT NULL, last_version INTEGER NOT NULL,
        event_count INTEGER NOT NULL, events_digest TEXT, result_digest TEXT,
        result_bytes BLOB NOT NULL,
        PRIMARY KEY(tenant,actor,state_name,op_id));`);
    // Additive, fail-closed upgrade: old snapshots lacking a trusted digest
    // cannot act as checkpoints for post-compaction recovery or deduplication.
    const snapshotColumns=this.db.prepare('PRAGMA table_info(snapshots)').all().map(r=>r.name);
    if(!snapshotColumns.includes('payload_hash'))
      this.db.exec('ALTER TABLE snapshots ADD COLUMN payload_hash TEXT');
    if(!snapshotColumns.includes('operation_digest'))
      this.db.exec('ALTER TABLE snapshots ADD COLUMN operation_digest TEXT');
    // Explicit fail-closed upgrade: previously saved command rows have no
    // trustworthy digest and cannot be acknowledged as durable duplicates.
    const commandColumns=this.db.prepare('PRAGMA table_info(command_commits)').all().map(r=>r.name);
    if(!commandColumns.includes('events_digest'))
      this.db.exec('ALTER TABLE command_commits ADD COLUMN events_digest TEXT');
    if(!commandColumns.includes('result_digest'))
      this.db.exec('ALTER TABLE command_commits ADD COLUMN result_digest TEXT');
    const operationColumns=this.db.prepare('PRAGMA table_info(operations)').all().map(r=>r.name);
    if(!operationColumns.includes('payload_hash'))
      this.db.exec('ALTER TABLE operations ADD COLUMN payload_hash TEXT');
    this.getFence = this.db.prepare('SELECT epoch FROM fences WHERE tenant=? AND actor=?');
    this.getOp = this.db.prepare('SELECT digest, version, kind FROM operations WHERE tenant=? AND actor=? AND state_name=? AND op_id=?');
    this.getHead = this.db.prepare('SELECT version FROM heads WHERE tenant=? AND actor=? AND state_name=?');
    this.putHead = this.db.prepare('INSERT INTO heads VALUES(?,?,?,?) ON CONFLICT(tenant,actor,state_name) DO UPDATE SET version=excluded.version');
    this.putSnapshot = this.db.prepare('INSERT INTO snapshots(tenant,actor,state_name,version,schema_version,payload,payload_hash,operation_digest) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant,actor,state_name) DO UPDATE SET version=excluded.version, schema_version=excluded.schema_version, payload=excluded.payload, payload_hash=excluded.payload_hash, operation_digest=excluded.operation_digest');
    this.putEvent = this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)');
    this.putOp = this.db.prepare('INSERT INTO operations(tenant,actor,state_name,op_id,digest,version,kind,payload_hash) VALUES(?,?,?,?,?,?,?,?)');
    this.getCommand = this.db.prepare('SELECT command_hash,first_version,last_version,event_count,events_digest,result_digest,result_bytes FROM command_commits WHERE tenant=? AND actor=? AND state_name=? AND op_id=?');
    this.putCommand = this.db.prepare('INSERT INTO command_commits(tenant,actor,state_name,op_id,command_hash,first_version,last_version,event_count,events_digest,result_digest,result_bytes) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
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
    if (this.getCommand.get(tenantId,actor,stateName,opId)) fail('OP_ID_CONFLICT');
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
  // New logical command API; shares the existing queue, SQLite transaction and CAS.
  // Guest-supplied tenant and epoch are NEVER trusted production authority.
  enqueueCommand(input) {
    const {tenantId,actor,stateName,opId,epoch,expectedVersion,
      schemaVersion=1,commandBytes,events,resultBytes=Buffer.from('null')}=input??{};
    if (tenantId!==this.tenantId) fail('WRONG_TENANT');
    if (![actor,stateName,opId].every(ident) || !uint(epoch) || epoch<1 ||
        !uint(expectedVersion) || !uint(schemaVersion) || schemaVersion<1 ||
        !Buffer.isBuffer(commandBytes) || !Buffer.isBuffer(resultBytes) ||
        !Array.isArray(events) || events.length<1 ||
        events.length>this.maxBatchEntries || !events.every(Buffer.isBuffer))
      fail('INVALID_COMMAND_WRITE');
    const eventBytes=events.reduce((n,b)=>n+b.length,0);
    if (commandBytes.length>this.maxPayloadBytes || resultBytes.length>this.maxPayloadBytes ||
        events.some(b=>b.length>this.maxPayloadBytes) || eventBytes>this.maxBatchBytes)
      fail('PAYLOAD_TOO_LARGE');
    const e={tenantId,actor,stateName,opId,epoch,expectedVersion,schemaVersion,
      kind:'command',commandBytes:Buffer.from(commandBytes),
      events:events.map(b=>Buffer.from(b)),resultBytes:Buffer.from(resultBytes),eventBytes};
    e.commandHash=hash_bytes(e.commandBytes);
    e.eventsDigest=events_digest(e.schemaVersion,e.events);
    e.resultDigest=hash_bytes(e.resultBytes);
    // Fence before dedup: stale actors cannot retrieve a prior success receipt.
    if(this.getFence.get(tenantId,actor)?.epoch!==epoch) fail('STALE_EPOCH');
    if(this.getCommand.get(tenantId,actor,stateName,opId))
      return this.verifyCommand({tenantId,actor,stateName,opId,epoch,
        commandBytes:e.commandBytes});
    if(this.getOp.get(tenantId,actor,stateName,opId))fail('OP_ID_CONFLICT');
    const k=key(e),attemptHash=hash_command_attempt(e),pending=this.pending.get(k);
    if(pending) {
      if(pending.hash!==attemptHash)fail('OP_ID_CONFLICT');
      return {opId,status:'admitted',durable:false,duplicate:true};
    }
    const charge=128+Buffer.byteLength(actor)+Buffer.byteLength(stateName)+
      Buffer.byteLength(opId)+e.commandBytes.length+e.resultBytes.length+
      eventBytes+64*e.events.length;
    if(this.queue.length>=this.maxQueuedEntries || charge>this.maxQueuedBytes-this.queuedBytes)
      fail('BACKPRESSURE');
    this.queue.push({e,hash:attemptHash,k,charge});
    this.pending.set(k,{hash:attemptHash});this.queuedBytes+=charge;
    return {opId,status:'admitted',durable:false,duplicate:false};
  }
  // A durable command receipt is trustworthy only when its provider record
  // agrees with the persisted stream/snapshot, not merely an op-ID lookup.
  // This helper is called inside the caller's SQLite read/write transaction.
  // A snapshot is not an authenticated checkpoint merely because its state
  // row has a version. Require BOTH exact durable BLOB digest and the snapshot
  // operation written in the same SQLite transaction. Digest+operation are
  // integrity evidence within the trusted provider, not an anti-tamper MAC.
  #verifySnapshot(tenantId,actor,stateName,saved) {
    if(!saved)return 0;
    if(!uint(saved.version) || saved.version<1 ||
       !uint(saved.schema_version) || saved.schema_version<1 ||
       !uint(saved.bytes) || saved.bytes>1048576 ||
       !(saved.payload instanceof Uint8Array) ||
       saved.payload.byteLength!==saved.bytes)fail('INVALID_ACTOR_SNAPSHOT');
    if(typeof saved.payload_hash!=='string' ||
       !/^[0-9a-f]{64}$/.test(saved.payload_hash))
      fail('UNVERIFIED_SNAPSHOT');
    if(hash_bytes(Buffer.from(saved.payload))!==saved.payload_hash)
      fail('CORRUPT_SNAPSHOT_PROOF');
    if(typeof saved.operation_digest!=='string' ||
       !/^[0-9a-f]{64}$/.test(saved.operation_digest))
      fail('UNVERIFIED_SNAPSHOT');
    const rows=this.db.prepare(
      'SELECT digest,payload_hash FROM operations WHERE tenant=? AND actor=? '+
      'AND state_name=? AND kind=? AND version=? LIMIT 2'
    ).all(tenantId,actor,stateName,'snapshot',saved.version);
    if(rows.length!==1 || rows[0].digest!==saved.operation_digest ||
       !/^[0-9a-f]{64}$/.test(rows[0].payload_hash??''))
      fail('UNVERIFIED_SNAPSHOT');
    if(rows[0].payload_hash!==saved.payload_hash)
      fail('CORRUPT_SNAPSHOT_PROOF');
    return saved.version;
  }

  #commandProof(tenantId,actor,stateName,opId,commandHash) {
    const old=this.getCommand.get(tenantId,actor,stateName,opId);
    if(!old)return null;
    if(old.command_hash!==commandHash)fail('OP_ID_CONFLICT');
    const head=this.getHead.get(tenantId,actor,stateName)?.version??0;
    if(!uint(head)||!uint(old.first_version)||old.first_version<1||
       !uint(old.last_version)||old.last_version>head||
       !uint(old.event_count)||old.event_count<1||old.event_count>10000||
       old.last_version-old.first_version+1!==old.event_count||
       !(old.result_bytes instanceof Uint8Array)||
       old.result_bytes.byteLength>1048576)
      fail('CORRUPT_COMMAND_RECORD');
    if(typeof old.events_digest!=='string' ||
       !/^[0-9a-f]{64}$/.test(old.events_digest) ||
       typeof old.result_digest!=='string' ||
       !/^[0-9a-f]{64}$/.test(old.result_digest))
      fail('UNVERIFIED_COMMAND_RECORD');
    if(hash_bytes(Buffer.from(old.result_bytes))!==old.result_digest)
      fail('CORRUPT_COMMAND_RESULT');
    const snap=this.db.prepare(
      'SELECT version,schema_version,length(payload) AS bytes,'+
      'substr(payload,1,1048577) AS payload,payload_hash,operation_digest FROM snapshots '+
      'WHERE tenant=? AND actor=? AND state_name=?'
    ).get(tenantId,actor,stateName);
    const snapshotVersion=this.#verifySnapshot(tenantId,actor,stateName,snap);
    if(snapshotVersion>head||
       (old.first_version<=snapshotVersion && old.last_version>snapshotVersion))
      fail('CORRUPT_COMMAND_RECORD');
    if(old.last_version>snapshotVersion) {
      const rows=this.db.prepare(
        'SELECT version,schema_version,length(payload) AS bytes,'+
        'substr(payload,1,1048577) AS payload '+
        'FROM events WHERE tenant=? AND actor=? AND state_name=? '+
        'AND op_id=? AND version BETWEEN ? AND ? ORDER BY version ASC'
      );
      let expected=old.first_version,total=0,schemaVersion=null;
      const events=[];
      for(const row of rows.iterate(tenantId,actor,stateName,opId,
                                    old.first_version,old.last_version)) {
        if(row.version!==expected || !uint(row.schema_version) ||
           row.schema_version<1 || !uint(row.bytes) || row.bytes>1048576 ||
           row.bytes>16777216-total ||
           !(row.payload instanceof Uint8Array) ||
           row.payload.byteLength!==row.bytes)
          fail('INCOMPLETE_COMMAND_JOURNAL');
        if(schemaVersion===null)schemaVersion=row.schema_version;
        if(row.schema_version!==schemaVersion)fail('INCOMPLETE_COMMAND_JOURNAL');
        total+=row.bytes;
        events.push(Buffer.from(row.payload));
        expected++;
      }
      if(expected!==old.last_version+1 ||
         events.length!==old.event_count ||
         events_digest(schemaVersion,events)!==old.events_digest)
        fail('INCOMPLETE_COMMAND_JOURNAL');
    }
    return {opId,status:'committed',durable:true,duplicate:true,
      firstVersion:old.first_version,version:old.last_version,
      eventCount:old.event_count,resultBytes:Buffer.from(old.result_bytes)};
  }
  verifyCommand({tenantId,actor,stateName,opId,epoch,commandBytes}={}) {
    if(tenantId!==this.tenantId)fail('WRONG_TENANT');
    if(![actor,stateName,opId].every(ident) || !uint(epoch) || epoch<1 ||
       !Buffer.isBuffer(commandBytes) || commandBytes.length>this.maxPayloadBytes)
      fail('INVALID_COMMAND_PROOF');
    this.db.exec('BEGIN');
    try {
      if(this.getFence.get(tenantId,actor)?.epoch!==epoch)fail('STALE_EPOCH');
      const proof=this.#commandProof(tenantId,actor,stateName,opId,hash_bytes(commandBytes));
      this.db.exec('COMMIT');
      return proof;
    } catch(err) {
      try{this.db.exec('ROLLBACK');}catch{}
      throw err;
    }
  }
  flush() {
    let bytes=0,count=0,rows=0;
    while(count<this.queue.length) {
      const e=this.queue[count].e;
      const needed=e.kind==='command'?e.events.length:1;
      const size=e.kind==='command'?e.eventBytes:e.payload.length;
      if(rows+needed>this.maxBatchEntries || bytes+size>this.maxBatchBytes)break;
      rows+=needed;bytes+=size;count++;
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
        if(e.kind==='command') {
          const old=this.getCommand.get(t,a,s,o);
          if(old) {
            if(old.command_hash!==e.commandHash)
              results.push({opId:o,status:'rejected',durable:false,code:'OP_ID_CONFLICT'});
            else
              results.push(this.#commandProof(t,a,s,o,e.commandHash));
            continue;
          }
          if(this.getOp.get(t,a,s,o)) {
            results.push({opId:o,status:'rejected',durable:false,code:'OP_ID_CONFLICT'});continue;
          }
          const version=this.getHead.get(t,a,s)?.version??0;
          if(version!==e.expectedVersion) {
            results.push({opId:o,status:'rejected',durable:false,code:'VERSION_CONFLICT'});continue;
          }
          if(e.events.length>Number.MAX_SAFE_INTEGER-version) {
            results.push({opId:o,status:'rejected',durable:false,code:'VERSION_EXHAUSTED'});continue;
          }
          for(let i=0;i<e.events.length;i++)
            this.putEvent.run(t,a,s,version+i+1,e.schemaVersion,o,e.events[i]);
          const next=version+e.events.length;
          this.putHead.run(t,a,s,next);
          this.putCommand.run(t,a,s,o,e.commandHash,version+1,next,e.events.length,
            e.eventsDigest,e.resultDigest,e.resultBytes);
          results.push({opId:o,status:'committed',durable:true,duplicate:false,
            firstVersion:version+1,version:next,eventCount:e.events.length,
            resultBytes:Buffer.from(e.resultBytes)});
          continue;
        }
        if(this.getCommand.get(t,a,s,o)) {
          results.push({opId:o,status:'rejected',durable:false,code:'OP_ID_CONFLICT'});continue;
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
        if (e.kind==='snapshot') this.putSnapshot.run(t,a,s,next,e.schemaVersion,e.payload,hash_bytes(e.payload),hash);
        else this.putEvent.run(t,a,s,next,e.schemaVersion,o,e.payload);
        this.putOp.run(t,a,s,o,hash,next,e.kind,hash_bytes(e.payload));
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
  // Fencing and the journal must be read under ONE SQLite snapshot.
  // BEGIN (deferred) pins an MVCC snapshot at the initial fence SELECT, so
  // another connection cannot swap generations halfway through replay.
  loadFenced({tenantId,actor,stateName,epoch}={}) {
    if (tenantId !== this.tenantId) fail('WRONG_TENANT');
    if (!ident(actor) || !ident(stateName) || !uint(epoch) || epoch < 1)
      fail('INVALID_READ');
    this.db.exec('BEGIN');
    try {
      if (this.getFence.get(tenantId,actor)?.epoch !== epoch) fail('STALE_EPOCH');
      const loaded = this.#readState(tenantId,actor,stateName);
      this.db.exec('COMMIT');
      return loaded;
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw err;
    }
  }
  // Host inspection only: never expose unfenced load() to actor guest code.
  load({tenantId,actor,stateName}={}) {
    if (tenantId !== this.tenantId) fail('WRONG_TENANT');
    if (![actor,stateName].every(ident)) fail('INVALID_READ');
    this.db.exec('BEGIN');
    try {
      const loaded = this.#readState(tenantId,actor,stateName);
      this.db.exec('COMMIT');
      return loaded;
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch {}
      throw err;
    }
  }
  #readState(tenantId,actor,stateName) {
    const head = this.getHead.get(tenantId,actor,stateName)?.version ?? 0;
    if (!uint(head)) fail('INCOMPLETE_ACTOR_JOURNAL');
    const saved = this.db.prepare(
      'SELECT version,schema_version,length(payload) AS bytes,' +
      'substr(payload,1,1048577) AS payload,payload_hash FROM snapshots ' +
      'WHERE tenant=? AND actor=? AND state_name=?'
    ).get(tenantId,actor,stateName);
    let snapshot=null, since=0;
    if (saved) {
      if (!uint(saved.version) || saved.version < 1 || saved.version > head ||
          !uint(saved.schema_version) || saved.schema_version < 1 ||
          !uint(saved.bytes) || saved.bytes > 1048576 ||
          !(saved.payload instanceof Uint8Array) ||
          saved.payload.byteLength !== saved.bytes) fail('INVALID_ACTOR_SNAPSHOT');
      since=this.#verifySnapshot(tenantId,actor,stateName,saved);
      snapshot={version:saved.version,schemaVersion:saved.schema_version,
        payload:Buffer.from(saved.payload)};
    }
    if (head - since > 10000) fail('ACTOR_JOURNAL_REPLAY_LIMIT');
    // LEFT JOIN both legacy single-event operations AND the newer logical
    // multi-event command index. Multiple events may share a command opId.
    // A replay event without either committed proof is corruption, not state.
    const events=[],commandProofs=new Map();
    let expected=since+1, aggregateBytes=0;
    const rows=this.db.prepare(
      'SELECT e.version,e.schema_version,e.op_id,length(e.payload) AS bytes,' +
      'substr(e.payload,1,1048577) AS payload,' +
      'o.version AS legacy_version,o.kind AS legacy_kind,' +
      'o.payload_hash AS legacy_payload_hash,' +
      'c.first_version AS command_first,c.last_version AS command_last,' +
      'c.event_count AS command_count,c.command_hash AS command_hash ' +
      'FROM events e LEFT JOIN operations o ON ' +
      'o.tenant=e.tenant AND o.actor=e.actor AND o.state_name=e.state_name ' +
      'AND o.op_id=e.op_id ' +
      'LEFT JOIN command_commits c ON ' +
      'c.tenant=e.tenant AND c.actor=e.actor AND c.state_name=e.state_name ' +
      'AND c.op_id=e.op_id ' +
      'WHERE e.tenant=? AND e.actor=? AND e.state_name=? AND e.version>? ' +
      'ORDER BY e.version ASC'
    );
    for (const event of rows.iterate(tenantId,actor,stateName,since)) {
      if (event.version !== expected) fail('JOURNAL_GAP');
      if (!ident(event.op_id)) fail('INCOMPLETE_OPERATION_LEDGER');
      const legacy=(event.legacy_version===event.version &&
                    event.legacy_kind==='event' && event.command_first===null);
      const command=(uint(event.command_first) && event.command_first>=1 &&
                     uint(event.command_last) && uint(event.command_count) &&
                     event.command_count>=1 &&
                     event.command_last-event.command_first+1===event.command_count &&
                     event.command_first<=event.version &&
                     event.version<=event.command_last && event.legacy_version===null);
      if (!legacy && !command) fail('INCOMPLETE_OPERATION_LEDGER');
      if(command) {
        if(!ident(event.command_hash) || 
           (event.command_first<=since && event.command_last>since))
          fail('INCOMPLETE_OPERATION_LEDGER');
        commandProofs.set(event.op_id,event.command_hash);
      }
      if (!uint(event.schema_version) || event.schema_version < 1 ||
          !uint(event.bytes) || event.bytes>1048576 ||
          event.bytes>16777216-aggregateBytes ||
          !(event.payload instanceof Uint8Array) ||
          event.payload.byteLength!==event.bytes) fail('INVALID_ACTOR_EVENT');
      if(legacy) {
        if(typeof event.legacy_payload_hash!=='string' ||
           !/^[0-9a-f]{64}$/.test(event.legacy_payload_hash))
          fail('UNVERIFIED_LEGACY_EVENT');
        if(hash_bytes(Buffer.from(event.payload))!==event.legacy_payload_hash)
          fail('CORRUPT_LEGACY_EVENT');
      }
      if (events.length>=10000) fail('ACTOR_JOURNAL_REPLAY_LIMIT');
      aggregateBytes+=event.bytes;
      events.push({version:event.version,schemaVersion:event.schema_version,
        opId:event.op_id,payload:Buffer.from(event.payload)});
      expected++;
    }
    if (expected !== head+1) fail('JOURNAL_GAP');
    // Verify each persisted logical command against original event payload
    // digest; tampered but syntactically valid JSON must not alter replay.
    for(const [opId,commandHash] of commandProofs) {
      if(!this.#commandProof(tenantId,actor,stateName,opId,commandHash))
        fail('INCOMPLETE_COMMAND_JOURNAL');
    }
    return {version:head,snapshot,events};
  }
  close() { this.db.close(); }
}
