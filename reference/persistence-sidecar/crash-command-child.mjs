// TEST-ONLY subprocess fixture. Executes the REAL Node SQLite sidecar path.
// Never import this helper in production or expose crash hooks to guest actors.
import {BatchPersistenceSidecar} from './sidecar.mjs';

const [path,phase]=process.argv.slice(2);
if(!path || !['before-begin','after-first-event','after-commit'].includes(phase))
  throw new Error('INVALID_TEST_PHASE');

const tenantId='tenant-crash',actor='bank-1',stateName='main';
const db=new BatchPersistenceSidecar({path,tenantId});
db.grantEpoch({tenantId,actor,epoch:1});
const write={
  tenantId,actor,stateName,opId:'deposit-100',epoch:1,
  expectedVersion:0,schemaVersion:1,
  commandBytes:Buffer.from('deposit:100'),
  events:[Buffer.from('{"delta":40}'),Buffer.from('{"delta":60}')],
  resultBytes:Buffer.from('{"balance_cents":100}')
};
if(db.enqueueCommand(write).status!=='admitted')
  throw new Error('TEST_COMMAND_NOT_ADMITTED');

// Testing via a TEMP trigger is intentionally limited to this child's
// connection. It kills the process inside the actual first sidecar INSERT,
// before the second event/head/result-index operations and COMMIT.
if(phase==='after-first-event') {
  db.db.function('crash_during_insert',()=>{
    process.kill(process.pid,'SIGKILL');
    return 0;
  });
  db.db.exec(`CREATE TEMP TRIGGER crash_first_event AFTER INSERT ON events
    WHEN NEW.actor='bank-1' AND NEW.version=1
    BEGIN SELECT crash_during_insert(); END;`);
}
if(phase==='after-commit') {
  // Hook the actual SQLite COMMIT invoked by BatchPersistenceSidecar.flush().
  // The original COMMIT must RETURN successfully before the SIGKILL.
  const exec=db.db.exec.bind(db.db);
  db.db.exec=(sql)=>{
    const result=exec(sql);
    if(sql.trim().toUpperCase()==='COMMIT')
      process.kill(process.pid,'SIGKILL');
    return result;
  };
}
if(phase==='before-begin')process.kill(process.pid,'SIGKILL');
db.flush();
throw new Error('CRASH_INJECTION_FAILED_TO_TERMINATE');
