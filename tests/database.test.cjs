const {test,before,after}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
let db,baseline,initializeSql;
const adminId='11111111-1111-4111-8111-111111111111',otherId='22222222-2222-4222-8222-222222222222';
async function as(role,id,fn){
 await db.exec(`set role ${role}`);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);
 try{return await fn()}finally{await db.exec('reset role')}
}
async function read(){return (await db.query('select public.expense_snapshot() as data')).rows[0].data}
async function commit(version,state){return (await db.query('select public.expense_commit($1,$2::jsonb) as data',[version,JSON.stringify(state)])).rows[0].data}
async function reset(){await db.query('update expense_private.ledger set version=1,state=$1::jsonb',[JSON.stringify(baseline.state)]);await db.exec('truncate expense_private.audit_log')}
const copy=x=>JSON.parse(JSON.stringify(x));
function expense(overrides={}){return {id:'local-test',group:'師培',department:'師培',category:1,date:'2026-01-01',requester:'測試',purpose:'預算邊界測試',incurred:1000,reimbursed:0,...overrides}}
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;insert into auth.users values('${adminId}'),('${otherId}');`);
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/202611090001_expense_ledger.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/202611100001_audit_index.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/202611100002_request_status.sql'),'utf8'));
 const privateFile=path.join(root,'private-import/baseline.json');
 baseline=!process.env.EXPENSE_TEST_SYNTHETIC&&fs.existsSync(privateFile)?JSON.parse(fs.readFileSync(privateFile,'utf8')):require('./synthetic-baseline.cjs')();
 const q=x=>"'"+JSON.stringify(x).replaceAll("'","''")+"'::jsonb";
 initializeSql=`begin;insert into expense_private.ledger(id,catalog,state) values(true,${q(baseline.catalog)},${q(baseline.state)});commit;`;
 await db.exec(initializeSql);
 await db.query('insert into expense_private.admins values($1)',[adminId]);
});
after(async()=>{await db?.close()});

test('353 rows reconcile to approved net totals and anonymous users can only read',async()=>{
 await reset();const snapshot=await as('anon',null,read);assert.equal(snapshot.state.records.length,353);assert.equal(snapshot.canAdmin,false);
 const total=k=>snapshot.state.records.reduce((n,r)=>n+Math.round(r[k]*100),0)/100;
 assert.equal(total('incurred')-snapshot.catalog.projectTotals.officeReclassifiedIncurred,7465834);
 assert.equal(total('reimbursed')-snapshot.catalog.projectTotals.officeReclassifiedReimbursed,6371741);
 await assert.rejects(as('anon',null,()=>commit(1,snapshot.state)),/permission denied/);
 await assert.rejects(as('anon',null,()=>db.query('select * from expense_private.ledger')),/permission denied/);
});
test('ordinary authenticated user cannot elevate privileges or commit',async()=>{
 await reset();assert.equal((await as('authenticated',otherId,read)).canAdmin,false);
 await assert.rejects(as('authenticated',otherId,()=>commit(1,baseline.state)),/ADMIN_REQUIRED/);
 await assert.rejects(as('authenticated',otherId,()=>db.exec(`insert into expense_private.admins values('${otherId}')`)),/permission denied/);
});
test('backdated zero-budget expense is blocked by server and transaction is unchanged',async()=>{
 await reset();const state=copy(baseline.state);state.records.push(expense({category:2,incurred:1,budgetReserved:false,origin:'excel'}));
 await assert.rejects(as('authenticated',adminId,()=>commit(1,state)),/BUDGET_EXCEEDED/);
 assert.equal((await read()).version,1);assert.equal((await read()).state.records.length,353);
 assert.equal((await db.query('select count(*)::int as n from expense_private.audit_log')).rows[0].n,0);
});
test('exact last 1000 passes and one cent beyond remaining fails',async()=>{
 await reset();const state=copy(baseline.state);state.records.push(expense({incurred:1000.01}));
 await assert.rejects(as('authenticated',adminId,()=>commit(1,state)),/BUDGET_EXCEEDED/);
 state.records.at(-1).incurred=1000;const saved=await as('authenticated',adminId,()=>commit(1,state));assert.equal(saved.version,2);
 assert.equal(saved.state.records.at(-1).budgetReserved,true);assert.equal(saved.state.records.at(-1).origin,'manual');
});
test('stale second admin write cannot overwrite the last budget or prior edits',async()=>{
 await reset();const a=copy(baseline.state),b=copy(baseline.state);a.records.push(expense());b.records.push(expense({id:'local-second'}));
 await as('authenticated',adminId,()=>commit(1,a));await assert.rejects(as('authenticated',adminId,()=>commit(1,b)),/VERSION_CONFLICT/);
 const current=await read();assert(current.state.records.some(r=>r.id==='local-test'));assert(!current.state.records.some(r=>r.id==='local-second'));
 await assert.rejects(as('authenticated',adminId,()=>commit(2,{...current.state,records:[...current.state.records,expense({id:'local-second',incurred:0.01})]})),/BUDGET_EXCEEDED/);
});
test('payment does not release incurred costs; deletion persists and is audited',async()=>{
 await reset();let s=copy(baseline.state);s.records.push(expense());let saved=await as('authenticated',adminId,()=>commit(1,s));
 s=saved.state;s.records.at(-1).reimbursed=1000;saved=await as('authenticated',adminId,()=>commit(2,s));assert.equal(saved.state.records.at(-1).incurred,1000);
 s=saved.state;s.deletedRecords.push(s.records.at(-1));s.records=s.records.filter(r=>r.id!=='local-test');saved=await as('authenticated',adminId,()=>commit(3,s));
 assert(!saved.state.records.some(r=>r.id==='local-test'));assert.equal(saved.state.deletedRecords.length,1);
 assert.equal((await db.query('select count(*)::int as n from expense_private.audit_log')).rows[0].n,3);
});
test('foreign travel is teaching-only and new travel needs its dedicated budget',async()=>{
 await reset();const s=copy(baseline.state);assert(s.records.filter(r=>r.category===12).every(r=>r.group==='教學部'));
 s.records.push(expense({category:12,group:'師培',incurred:1}));await assert.rejects(as('authenticated',adminId,()=>commit(1,s)),/BUDGET_EXCEEDED/);
});
test('duplicate budgets, fractional cents, invalid dates and overpayments are rejected',async()=>{
 for(const mutation of [
   s=>{s.budgets[0]=s.budgets[1]},
   s=>{s.records.push(expense({incurred:0.001}))},
   s=>{s.records.push(expense({date:'2026-02-31'}))},
   s=>{s.records.push(expense({reimbursed:1001}))}
 ]){await reset();const s=copy(baseline.state);mutation(s);await assert.rejects(as('authenticated',adminId,()=>commit(1,s)))}
});
test('initial import refuses to overwrite a live ledger on second execution',async()=>{
 await reset();await assert.rejects(db.exec(initializeSql),/duplicate key/);await db.exec('rollback');assert.equal((await read()).version,1);
});
test('read-only polling does not update data date; replayed successful request is idempotent',async()=>{
 await reset();const initial=await read();await read();assert.equal((await read()).updatedAt,initial.updatedAt);
 const state=copy(baseline.state);state.records.push(expense());const requestId='33333333-3333-4333-8333-333333333333';
 const write=()=>db.query('select public.expense_commit($1,$2::jsonb,$3::uuid) as data',[1,JSON.stringify(state),requestId]);
 const first=(await as('authenticated',adminId,write)).rows[0].data;
 const replay=(await as('authenticated',adminId,write)).rows[0].data;
 assert.equal(replay.version,2);assert.equal(replay.updatedAt,first.updatedAt);assert.equal(replay.state.records.length,354);
 assert.equal((await db.query('select count(*)::int as n from expense_private.audit_log')).rows[0].n,1);
 const ack=await as('authenticated',adminId,()=>db.query('select public.expense_request_status($1::uuid) as data',[requestId]));
 assert.equal(ack.rows[0].data.committed,true);assert.equal(ack.rows[0].data.snapshot.version,2);
});
