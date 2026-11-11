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
const hash_command_attempt = (e) => hash_bytes(Buffer.from(JSON.stringify([
  e.tenantId,e.actor,e.stateName,e.opId,e.epoch,e.expectedVersion,
  e.schemaVersion,e.commandHash,e.events.map(b=>b.toString('base64')),
  e.resultBytes.toString('base64')
])));
const checkpoint_hash = (e) => hash_bytes(Buffer.from(JSON.stringify([
  e.tenantId,e.actor,e.stateName,e.version,e.schemaVersion,e.payload.toString('base64')
])));
const key = (e) => JSON.stringify([e.actor, e.stateName, e.opId]);
const digest = (e) => createHash('sha256').update(JSON.stringify([
  e.tenantId,e.actor,e.stateName,e.opId,e.epoch,e.expectedVersion,
  e.kind,e.schemaVersion,e.payload.toString('base64')
])).digest('hex');

export class BatchPersistenceSidecar {
  constructor({ path, tenantId, maxQueuedBytes = 4 * 1024 * 1024,
    maxPayloadBytes = 64 * 1024, maxQueuedEntries = 4096, maxBatchEntries = 256,
    maxBatchBytes = 1024 * 1024, maxReplayEvents = 65536,
    maxIndexedCommands = 262144 }) {
    if (!ident(tenantId) || !ident(path)) fail('INVALID_CONFIG');
    if (![maxQueuedBytes,maxPayloadBytes,maxQueuedEntries,maxBatchEntries,maxBatchBytes].every(n => uint(n) && n > 0) ||
        !uint(maxReplayEvents) || maxReplayEvents < 1 || maxReplayEvents > 65536 ||
        !uint(maxIndexedCommands) || maxIndexedCommands < 1 || maxIndexedCommands > 262144)
      fail('INVALID_CONFIG');
    this.tenantId = tenantId;
    this.maxQueuedBytes = maxQueuedBytes;
    this.maxPayloadBytes = maxPayloadBytes;
    this.maxQueuedEntries = maxQueuedEntries;
    this.maxBatchEntries = maxBatchEntries;
    this.maxBatchBytes = maxBatchBytes;
    this.maxReplayEvents = maxReplayEvents;
    this.maxIndexedCommands = maxIndexedCommands;
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
        PRIMARY KEY(tenant,actor,state_name,op_id));
      CREATE TABLE IF NOT EXISTS command_commits (
        tenant TEXT NOT NULL, actor TEXT NOT NULL, state_name TEXT NOT NULL,
        op_id TEXT NOT NULL, command_hash TEXT NOT NULL,
        first_version INTEGER NOT NULL, last_version INTEGER NOT NULL,
        event_count INTEGER NOT NULL, result_bytes BLOB NOT NULL,
        PRIMARY KEY(tenant,actor,state_name,op_id));
      -- This is distinct from a legacy snapshot event: no new stream version.
      CREATE TABLE IF NOT EXISTS checkpoints (
        tenant TEXT NOT NULL, actor TEXT NOT NULL, state_name TEXT NOT NULL,
        version INTEGER NOT NULL, schema_version INTEGER NOT NULL,
        payload BLOB NOT NULL, digest TEXT NOT NULL,
        PRIMARY KEY(tenant,actor,state_name));
      CREATE TABLE IF NOT EXISTS checkpoint_index_manifests (
        tenant TEXT NOT NULL, actor TEXT NOT NULL, state_name TEXT NOT NULL,
        version INTEGER NOT NULL, command_count INTEGER NOT NULL,
        command_digest TEXT NOT NULL,
        PRIMARY KEY(tenant,actor,state_name));
      -- Stable command receipts must not disappear after compaction.
      CREATE TRIGGER IF NOT EXISTS immutable_command_commits_delete
        BEFORE DELETE ON command_commits
        BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COMMAND_INDEX'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_command_commits_update
        BEFORE UPDATE ON command_commits
        BEGIN SELECT RAISE(ABORT,'IMMUTABLE_COMMAND_INDEX'); END;`);
    this.getFence = this.db.prepare('SELECT epoch FROM fences WHERE tenant=? AND actor=?');
    this.getOp = this.db.prepare('SELECT digest, version, kind FROM operations WHERE tenant=? AND actor=? AND state_name=? AND op_id=?');
    this.getHead = this.db.prepare('SELECT version FROM heads WHERE tenant=? AND actor=? AND state_name=?');
    this.putHead = this.db.prepare('INSERT INTO heads VALUES(?,?,?,?) ON CONFLICT(tenant,actor,state_name) DO UPDATE SET version=excluded.version');
    this.putSnapshot = this.db.prepare('INSERT INTO snapshots VALUES(?,?,?,?,?,?) ON CONFLICT(tenant,actor,state_name) DO UPDATE SET version=excluded.version, schema_version=excluded.schema_version, payload=excluded.payload');
    this.putEvent = this.db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?)');
    this.putOp = this.db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?,?)');
    this.getCommand = this.db.prepare('SELECT command_hash,first_version,last_version,event_count,result_bytes FROM command_commits WHERE tenant=? AND actor=? AND state_name=? AND op_id=?');
    this.putCommand = this.db.prepare('INSERT INTO command_commits VALUES(?,?,?,?,?,?,?,?,?)');
    this.getCheckpoint = this.db.prepare('SELECT version,schema_version,payload,digest FROM checkpoints WHERE tenant=? AND actor=? AND state_name=?');
    this.putCheckpoint = this.db.prepare('INSERT INTO checkpoints VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant,actor,state_name) DO UPDATE SET version=excluded.version,schema_version=excluded.schema_version,payload=excluded.payload,digest=excluded.digest');
    this.getLegacySnapshot = this.db.prepare('SELECT version,schema_version,payload FROM snapshots WHERE tenant=? AND actor=? AND state_name=?');
    this.readCheckpointEvents = this.db.prepare('SELECT version,op_id,schema_version FROM events WHERE tenant=? AND actor=? AND state_name=? AND version>? AND version<=? ORDER BY version ASC');
    this.pruneCheckpointEvents = this.db.prepare('DELETE FROM events WHERE tenant=? AND actor=? AND state_name=? AND version<=?');
    this.getCheckpointManifest = this.db.prepare('SELECT version,command_count,command_digest FROM checkpoint_index_manifests WHERE tenant=? AND actor=? AND state_name=?');
    this.putCheckpointManifest = this.db.prepare('INSERT INTO checkpoint_index_manifests VALUES(?,?,?,?,?,?) ON CONFLICT(tenant,actor,state_name) DO UPDATE SET version=excluded.version,command_count=excluded.command_count,command_digest=excluded.command_digest');
    this.readIndexedCommands = this.db.prepare('SELECT op_id,command_hash,first_version,last_version,event_count,result_bytes FROM command_commits WHERE tenant=? AND actor=? AND state_name=? AND last_version<=? ORDER BY first_version ASC,op_id ASC');
  }
  // Cover the full retained command history through the checkpoint boundary.
  // Host-only O(N) audit, bounded to prevent unbounded checkpoint/recovery work.
  commandIndexDigest(tenantId,actor,stateName,version) {
    let count=0,covered=0;const h=createHash('sha256');
    for(const row of this.readIndexedCommands.iterate(tenantId,actor,stateName,version)) {
      if(++count>this.maxIndexedCommands)fail('COMMAND_INDEX_LIMIT_EXCEEDED');
      if(!ident(row.op_id) || typeof row.command_hash!=='string' ||
         !/^[0-9a-f]{64}$/.test(row.command_hash) ||
         !uint(row.first_version) || row.first_version!==covered+1 ||
         !uint(row.last_version) || !uint(row.event_count) ||
         row.last_version-row.first_version+1!==row.event_count ||
         !Buffer.isBuffer(row.result_bytes))fail('CORRUPT_COMMAND_INDEX');
      h.update(JSON.stringify([row.op_id,row.command_hash,row.first_version,
        row.last_version,row.event_count,row.result_bytes.toString('base64')])+'\n');
      covered=row.last_version;
    }
    if(covered!==version)fail('CORRUPT_COMMAND_INDEX');
    return {commandCount:count,commandDigest:h.digest('hex')};
  }
  verifyCheckpointIndex(tenantId,actor,stateName,checkpoint) {
    const manifest=this.getCheckpointManifest.get(tenantId,actor,stateName);
    if(!manifest || manifest.version!==checkpoint.version)
      fail('COMMAND_INDEX_MANIFEST_REQUIRED');
    const summary=this.commandIndexDigest(tenantId,actor,stateName,checkpoint.version);
    if(manifest.command_count!==summary.commandCount ||
       manifest.command_digest!==summary.commandDigest)
      fail('CORRUPT_COMMAND_INDEX');
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
    // Bound the ENTIRE batch write, including command and durable result bytes;
    // event-only accounting would bypass the configured batch byte budget.
    const batchBytes=eventBytes+commandBytes.length+resultBytes.length;
    if (commandBytes.length>this.maxPayloadBytes || resultBytes.length>this.maxPayloadBytes ||
        events.some(b=>b.length>this.maxPayloadBytes) || batchBytes>this.maxBatchBytes)
      fail('PAYLOAD_TOO_LARGE');
    const e={tenantId,actor,stateName,opId,epoch,expectedVersion,schemaVersion,
      kind:'command',commandBytes:Buffer.from(commandBytes),
      events:events.map(b=>Buffer.from(b)),resultBytes:Buffer.from(resultBytes),eventBytes,batchBytes};
    e.commandHash=hash_bytes(e.commandBytes);
    // Fence before dedup: stale actors cannot retrieve a prior success receipt.
    if(this.getFence.get(tenantId,actor)?.epoch!==epoch) fail('STALE_EPOCH');
    const old=this.getCommand.get(tenantId,actor,stateName,opId);
    if(old) return this.verifyCommand({tenantId,actor,stateName,opId,epoch,
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
  verifyCommand({tenantId,actor,stateName,opId,epoch,commandBytes}={}) {
    if(tenantId!==this.tenantId)fail('WRONG_TENANT');
    if(![actor,stateName,opId].every(ident) || !uint(epoch) || epoch<1 ||
       !Buffer.isBuffer(commandBytes) || commandBytes.length>this.maxPayloadBytes)
      fail('INVALID_COMMAND_PROOF');
    if(this.getFence.get(tenantId,actor)?.epoch!==epoch)fail('STALE_EPOCH');
    const old=this.getCommand.get(tenantId,actor,stateName,opId);
    if(!old)return null;
    if(old.command_hash!==hash_bytes(commandBytes))fail('OP_ID_CONFLICT');
    if(!uint(old.first_version)||old.first_version<1||!uint(old.last_version)||
       !uint(old.event_count)||old.event_count<1||
       old.last_version-old.first_version+1!==old.event_count ||
       old.last_version>(this.getHead.get(tenantId,actor,stateName)?.version??0))
      fail('CORRUPT_COMMAND_RECORD');
    return {opId,status:'committed',durable:true,duplicate:true,
      firstVersion:old.first_version,version:old.last_version,
      eventCount:old.event_count,resultBytes:Buffer.from(old.result_bytes)};
  }
  flush() {
    let bytes=0,count=0,rows=0;
    while(count<this.queue.length) {
      const e=this.queue[count].e;
      const needed=e.kind==='command'?e.events.length:1;
      const size=e.kind==='command'?e.batchBytes:e.payload.length;
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
            if(old.command_hash!==e.commandHash) {
              results.push({opId:o,status:'rejected',durable:false,code:'OP_ID_CONFLICT'});
            } else {
              results.push(this.verifyCommand({tenantId:t,actor:a,stateName:s,
                opId:o,epoch:e.epoch,commandBytes:e.commandBytes}));
            }
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
          this.putCommand.run(t,a,s,o,e.commandHash,version+1,next,e.events.length,e.resultBytes);
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
  // Trusted-host checkpoint from already verified actor state. All-or-none
  // provider CAS, checkpoint and pruning. The digest detects accidental
  // corruption; it does not authenticate a compromised database writer.
  checkpointAndCompact(input) {
    const {tenantId,actor,stateName,epoch,expectedVersion,schemaVersion=1,payload}=input??{};
    if(tenantId!==this.tenantId)fail('WRONG_TENANT');
    if(!ident(actor)||!ident(stateName)||!uint(epoch)||epoch<1||
       !uint(expectedVersion)||expectedVersion<1||!uint(schemaVersion)||
       schemaVersion<1||!Buffer.isBuffer(payload))fail('INVALID_CHECKPOINT');
    if(payload.length>this.maxPayloadBytes)fail('PAYLOAD_TOO_LARGE');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(this.getFence.get(tenantId,actor)?.epoch!==epoch)fail('STALE_EPOCH');
      const head=this.getHead.get(tenantId,actor,stateName)?.version??0;
      if(head!==expectedVersion)fail('VERSION_CONFLICT');
      if(this.getLegacySnapshot.get(tenantId,actor,stateName))
        fail('LEGACY_SNAPSHOT_PRESENT');
      const old=this.getCheckpoint.get(tenantId,actor,stateName);
      let from=0;
      if(old) {
        this.verifyCheckpointIndex(tenantId,actor,stateName,old);
        const owned=Buffer.from(old.payload);
        if(!uint(old.version)||old.version<1||old.version>head||
           !uint(old.schema_version)||old.schema_version<1||
           old.digest!==checkpoint_hash({tenantId,actor,stateName,version:old.version,
             schemaVersion:old.schema_version,payload:owned}))fail('CORRUPT_CHECKPOINT');
        if(old.schema_version!==schemaVersion)fail('SCHEMA_MIGRATION_REQUIRED');
        if(old.version===expectedVersion) {
          if(!owned.equals(payload))fail('CHECKPOINT_CONFLICT');
          this.db.exec('COMMIT');
          return {status:'committed',durable:true,duplicate:true,
            version:expectedVersion,prunedEvents:0};
        }
        from=old.version;
      }
      // Iterate instead of materializing unbounded journal rows.
      let count=0;
      for(const entry of this.readCheckpointEvents.iterate(tenantId,actor,stateName,from,expectedVersion)) {
        count++;
        if(count>this.maxReplayEvents)fail('REPLAY_LIMIT_EXCEEDED');
        if(entry.version!==from+count)fail('JOURNAL_GAP');
        if(entry.schema_version!==schemaVersion)fail('SCHEMA_MIGRATION_REQUIRED');
        const cmd=this.getCommand.get(tenantId,actor,stateName,entry.op_id);
        if(!cmd||entry.version<cmd.first_version||entry.version>cmd.last_version||
           !uint(cmd.event_count)||cmd.event_count<1||
           cmd.last_version-cmd.first_version+1!==cmd.event_count)
          fail('UNINDEXED_JOURNAL');
      }
      if(count!==expectedVersion-from)fail('JOURNAL_GAP');
      const index=this.commandIndexDigest(tenantId,actor,stateName,expectedVersion);
      this.putCheckpoint.run(tenantId,actor,stateName,expectedVersion,schemaVersion,
        Buffer.from(payload),checkpoint_hash({tenantId,actor,stateName,
          version:expectedVersion,schemaVersion,payload}));
      this.putCheckpointManifest.run(tenantId,actor,stateName,expectedVersion,
        index.commandCount,index.commandDigest);
      const pruned=this.pruneCheckpointEvents.run(tenantId,actor,stateName,expectedVersion);
      if(pruned.changes!==count)fail('JOURNAL_GAP');
      this.db.exec('COMMIT');
      return {status:'committed',durable:true,duplicate:false,
        version:expectedVersion,prunedEvents:count};
    } catch(e) {
      try{this.db.exec('ROLLBACK');}catch{}
      if(e instanceof AdmissionError)throw e;
      fail('OUTCOME_UNKNOWN');
    }
  }
  // Loading durable actor state is activation-scoped; old epochs must not restore it.
  loadFenced({tenantId,actor,stateName,epoch}) {
    if (tenantId !== this.tenantId) fail('WRONG_TENANT');
    if (!ident(actor) || !ident(stateName) || !uint(epoch) || epoch < 1)
      fail('INVALID_READ');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(this.getFence.get(tenantId,actor)?.epoch!==epoch)fail('STALE_EPOCH');
      const state=this.load({tenantId,actor,stateName});
      this.db.exec('COMMIT');return state;
    } catch(e) {
      try{this.db.exec('ROLLBACK');}catch{}
      throw e;
    }
  }
  load({tenantId,actor,stateName}) {
    if (tenantId !== this.tenantId) fail('WRONG_TENANT');
    if (![actor,stateName].every(ident)) fail('INVALID_READ');
    const version=this.getHead.get(tenantId,actor,stateName)?.version??0;
    const checkpoint=this.getCheckpoint.get(tenantId,actor,stateName);
    const legacy=this.getLegacySnapshot.get(tenantId,actor,stateName);
    if(checkpoint&&legacy)fail('AMBIGUOUS_SNAPSHOT');
    let snapshot=null;
    if(checkpoint) {
      const owned=Buffer.from(checkpoint.payload);
      if(!uint(checkpoint.version)||checkpoint.version<1||checkpoint.version>version||
         !uint(checkpoint.schema_version)||checkpoint.schema_version<1||
         checkpoint.digest!==checkpoint_hash({tenantId,actor,stateName,
           version:checkpoint.version,schemaVersion:checkpoint.schema_version,payload:owned}))
        fail('CORRUPT_CHECKPOINT');
      this.verifyCheckpointIndex(tenantId,actor,stateName,checkpoint);
      snapshot={version:checkpoint.version,schemaVersion:checkpoint.schema_version,
        payload:owned,provenance:'command_checkpoint_v1',verifiedCommandIndex:true};
    } else if(legacy) {
      snapshot={version:legacy.version,schemaVersion:legacy.schema_version,
        payload:Buffer.from(legacy.payload)};
    }
    const since=snapshot?.version??0;
    const events=this.db.prepare('SELECT version,schema_version,op_id,payload FROM events WHERE tenant=? AND actor=? AND state_name=? AND version>? ORDER BY version ASC LIMIT ?').all(tenantId,actor,stateName,since,this.maxReplayEvents+1);
    if(events.length>this.maxReplayEvents)fail('REPLAY_LIMIT_EXCEEDED');
    if(checkpoint) {
      // A legacy/unindexed write after compaction must not become replayable.
      for(const e of events) {
        const cmd=this.getCommand.get(tenantId,actor,stateName,e.op_id);
        if(!cmd || e.version<cmd.first_version || e.version>cmd.last_version ||
           cmd.last_version-cmd.first_version+1!==cmd.event_count)
          fail('UNINDEXED_JOURNAL');
      }
    }
    return {version,snapshot,events:events.map(x=>({version:x.version,
      schemaVersion:x.schema_version,opId:x.op_id,payload:Buffer.from(x.payload)}))};
  }
  close() { this.db.close(); }
}
