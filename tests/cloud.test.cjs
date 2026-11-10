const {test,before}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');let ExpenseCloud;
const baseline=require('./synthetic-baseline.cjs')();
const clone=x=>JSON.parse(JSON.stringify(x));
const payload=(canAdmin=false,version=1)=>({catalog:clone(baseline.catalog),state:clone(baseline.state),version,canAdmin,updatedAt:'2026-11-09T16:30:00Z'});
before(async()=>{({ExpenseCloud}=await import('../web/cloud.js'))});
test('cloud data comes only from the RPC response, never a local ledger',async()=>{
 const client={rpc:async name=>{assert.equal(name,'expense_snapshot');return {data:payload(),error:null}}};
 const store=new ExpenseCloud(client);await store.read();assert.equal(store.canAdmin,false);assert.equal(store.current.records.length,353);
 assert(!fs.readFileSync(path.join(root,'web/app.js'),'utf8').includes('localStorage'));
});
test('only DB-confirmed admin may commit and every commit carries its expected version',async()=>{
 let writes=0;const client={rpc:async(name,parameters)=>{if(name==='expense_commit'){writes++;assert.equal(parameters.p_version,1);assert(!('catalog' in parameters.p_state));return {data:payload(true,2),error:null}}return {data:payload(true),error:null}}};
 const store=new ExpenseCloud(client);await assert.rejects(store.commit(baseline.state),/管理者/);await store.read();await store.commit(baseline.state);assert.equal(writes,1);assert.equal(store.version,2);
});
test('server conflict does not become a successful local save',async()=>{
 const store=new ExpenseCloud({rpc:async()=>({error:{message:'VERSION_CONFLICT'},data:null})});store.accept(payload(true));
 await assert.rejects(store.commit(baseline.state),/本次未儲存/);assert.equal(store.version,1);
});
test('delayed poll cannot replace a newer committed snapshot',()=>{
 const store=new ExpenseCloud({});store.accept(payload(true,2));store.current.records[0].note='newer';
 store.accept(payload(true,1));assert.equal(store.version,2);assert.equal(store.current.records[0].note,'newer');
});
test('cloud outage is an explicit failure instead of falling back to the Excel bundle',async()=>{
 const store=new ExpenseCloud({rpc:async()=>({error:{message:'network failure'},data:null})});await assert.rejects(store.read(),/雲端連線/);assert.equal(store.current,null);
});
test('expired JWT refreshes once and resumes reading cloud data',async()=>{
 let calls=0,refreshes=0;
 const client={rpc:async()=>++calls===1?{error:{code:'PGRST301',message:'JWT expired'}}:{data:payload(true),error:null},auth:{refreshSession:async()=>{refreshes++;return {data:{session:{access_token:'test'}},error:null}}}};
 const store=new ExpenseCloud(client,{wait:async()=>{}});await store.read();assert.equal(refreshes,1);assert.equal(store.canAdmin,true);assert.equal(store.version,1);
});
test('revoked refresh session falls back to a fresh anonymous viewer, never admin rights',async()=>{
 const client={rpc:async()=>({error:{message:'JWT expired',status:401}}),auth:{refreshSession:async()=>({error:{message:'revoked'}}),signOut:async()=>({error:null})}};
 const store=new ExpenseCloud(client,{anonymousClient:{rpc:async()=>({data:payload(false),error:null})},wait:async()=>{}});await store.read();assert.equal(store.canAdmin,false);assert.equal(store.current.records.length,353);
});
test('transient read failure retries and overlapping reads share one request',async()=>{
 let calls=0;const store=new ExpenseCloud({rpc:async()=>++calls===1?{error:{message:'fetch failed',status:503}}:{data:payload(),error:null}},{wait:async()=>{}});
 const [a,b]=await Promise.all([store.read(),store.read()]);assert.equal(calls,2);assert.equal(a.records.length,b.records.length);
});
test('lost write response retries with same request UUID and expected version',async()=>{
 const requests=[];const store=new ExpenseCloud({rpc:async(name,args)=>{requests.push(clone(args));return requests.length===1?{error:{message:'fetch failed',status:0}}:{data:payload(true,2),error:null}}},{wait:async()=>{}});store.accept(payload(true));await store.commit(baseline.state);
 assert.equal(requests.length,2);assert.equal(requests[0].p_request_id,requests[1].p_request_id);assert.equal(requests[1].p_version,1);assert.equal(store.version,2);
});
test('two lost write responses consult read-only acknowledgement before reporting success',async()=>{
 let writes=0,acks=0;const store=new ExpenseCloud({rpc:async(name,args)=>{
  if(name==='expense_commit'){writes++;return {error:{message:'network lost',status:0}}}
  assert.equal(name,'expense_request_status');acks++;return {data:{committed:true,snapshot:payload(true,2)},error:null};
 }},{wait:async()=>{}});store.accept(payload(true));await store.commit(baseline.state);assert.equal(writes,2);assert.equal(acks,1);assert.equal(store.version,2);
});
test('unconfirmed network write is explicitly uncertain, never falsely reported unsaved',async()=>{
 const store=new ExpenseCloud({rpc:async()=>({error:{message:'network lost',status:0}})},{wait:async()=>{}});store.accept(payload(true));
 await assert.rejects(store.commit(baseline.state),e=>e.code==='UNCERTAIN_COMMIT');
});

function ui(file){
 const html=fs.readFileSync(path.join(root,'web',file),'utf8'),ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1])),nodes=new Map();
 const get=id=>{assert(ids.has(id),id);if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',hidden:false,open:false,disabled:false,dataset:{},classList:{remove(){},toggle(){}},addEventListener(){},showModal(){this.open=true},close(){this.open=false},focus(){}});return nodes.get(id)};
 const document={hidden:false,addEventListener(){},body:{dataset:file==='admin.html'?{mode:'admin'}:{},classList:{add(){},remove(){}}},querySelector:s=>get(s.slice(1)),querySelectorAll:()=>[]};
 const Cloud={catalog:clone(baseline.catalog),current:clone(baseline.state),version:1,updatedAt:'2026-11-09T16:30:00Z',canAdmin:file==='admin.html',async read(){return clone(this.current)},async commit(s){this.current=clone(s);return clone(s)}};
 const context={Cloud,SEED:{...clone(baseline.catalog),records:[],budgets:[]},document,console,structuredClone,location:{},navigator:{},setInterval(){},setTimeout(){},clearTimeout(){},addEventListener(){},confirm:()=>true,crypto:{randomUUID:()=>String(Math.random())}};context.window=context;vm.createContext(context);
 vm.runInContext(fs.readFileSync(path.join(root,'web/ledger.js'),'utf8').replace('export default api;', 'window.Ledger=api;'),context);vm.runInContext(fs.readFileSync(path.join(root,'web/app.js'),'utf8'),context);
 return {context,nodes,read:s=>vm.runInContext(s,context)};
}
test('cloud Viewer and admin render the same net totals and keep group/dialog calculations',()=>{
 for(const file of ['index.html','admin.html']){
  const p=ui(file);assert.equal(p.read('projectTotals().incurred'),7465834);assert.equal(p.read('projectTotals().reimbursed'),6371741);
  assert(p.nodes.get('stats').innerHTML.includes('7,465,834'));assert(p.nodes.get('record-summary').textContent.includes('6,371,741'));
  assert.equal(p.read('closeoutRows().length'),21);assert.equal(p.read('groupDetailRows(SEED.groups[0]).length'),21);
  assert.equal(p.read('admin'),file==='admin.html');
 }
});
test('rejected server write restores the display and never shows a success toast',async()=>{
 const p=ui('admin.html');p.context.Cloud.commit=async()=>{throw Error('VERSION_CONFLICT')};
 const pending=p.read("writeChange(()=>{records=[...records,{id:'local-extra',group:groups[0],category:1,date:'2026-11-09',incurred:1,reimbursed:0}];persist();toast('SAVED')})");
 await assert.rejects(pending,/VERSION_CONFLICT/);assert.equal(p.read('records.length'),353);assert.notEqual(p.nodes.get('toast').textContent,'SAVED');
});
test('sidebar uses Taiwan date only and background reads do not change the update date',async()=>{
 const p=ui('index.html');const before=p.nodes.get('data-updated-date').textContent;assert.equal(before,'資料更新日期：2026-11-10');await p.read('syncCloud(true)');assert.equal(p.nodes.get('data-updated-date').textContent,before);
});
test('stale data is hidden on connection failure and reconnect restores fresh state',async()=>{
 const p=ui('index.html');p.context.Cloud.read=async()=>{throw Error('offline')};await p.read('syncCloud(true)');assert.equal(p.nodes.get('connection-banner').hidden,false);assert.equal(p.nodes.get('expense-save').disabled,true);
 p.context.Cloud.read=async()=>clone(baseline.state);await p.read('syncCloud(true)');assert.equal(p.nodes.get('connection-banner').hidden,true);
});
test('editing an old version cannot silently overwrite refreshed data',async()=>{
 const p=ui('admin.html');p.read("$('#editor').open=true;$('#editor').dataset.version='1'");p.context.Cloud.version=2;
 await assert.rejects(p.read('writeChange(()=>{throw Error("action must not run")})'),/其他人更新/);assert.equal(p.context.Cloud.version,2);
});
test('budget save stays open, refreshes version and allows saving the next group directly',async()=>{
 const p=ui('admin.html');await p.read('openBudget(groups[0])');
 p.context.Cloud.commit=async s=>{p.context.Cloud.version++;p.context.Cloud.current=clone(s);return clone(s)};
 let inputs=[];p.context.document.querySelectorAll=selector=>selector==='[data-allocated]'?inputs:[];
 const setInputs=(group,amount)=>{inputs=p.context.Cloud.current.budgets.filter(b=>b.group===group).map(b=>({dataset:{allocated:String(b.category)},value:String(b.category===1?amount:b.amount),disabled:false}))};
 const first=baseline.catalog.groups[0],second=baseline.catalog.groups[1];setInputs(first,25000);
 await p.nodes.get('budget-form').onsubmit({preventDefault(){}});
 assert.equal(p.nodes.get('budget-dialog').open,true);assert.equal(p.nodes.get('budget-group').value,first);assert.equal(p.nodes.get('budget-dialog').dataset.version,'2');assert.equal(p.nodes.get('budget-dialog').dataset.dirty,'');
 assert(p.nodes.get('budget-status').textContent.includes('已儲存'));
 p.context.confirm=()=>{throw Error('Saved group must not prompt to discard changes')};p.context.nextGroup=second;p.read("$('#budget-group').value=nextGroup;$('#budget-group').onchange()");
 setInputs(second,100);await p.nodes.get('budget-form').onsubmit({preventDefault(){}});
 assert.equal(p.nodes.get('budget-dialog').open,true);assert.equal(p.nodes.get('budget-group').value,second);assert.equal(p.nodes.get('budget-dialog').dataset.version,'3');
 assert.equal(p.context.Cloud.current.budgets.find(b=>b.group===first&&b.category===1).amount,25000);assert.equal(p.context.Cloud.current.budgets.find(b=>b.group===second&&b.category===1).amount,100);
 assert.equal(p.nodes.get('budget-save').disabled,false);
});
test('failed budget save keeps dialog, draft inputs and dirty marker for correction',async()=>{
 const p=ui('admin.html');await p.read('openBudget(groups[0])');const group=baseline.catalog.groups[0];
 const inputs=p.context.Cloud.current.budgets.filter(b=>b.group===group).map(b=>({dataset:{allocated:String(b.category)},value:String(b.category===1?26000:b.amount),disabled:false}));
 p.context.document.querySelectorAll=selector=>selector==='[data-allocated]'?inputs:[];
 p.read("$('#budget-dialog').dataset.dirty='yes'");p.context.Cloud.commit=async()=>{throw Error('VERSION_CONFLICT')};
 await p.nodes.get('budget-form').onsubmit({preventDefault(){}});
 assert.equal(p.nodes.get('budget-dialog').open,true);assert.equal(p.nodes.get('budget-dialog').dataset.dirty,'yes');assert.equal(inputs[0].value,'26000');assert.equal(p.nodes.get('budget-error').textContent,'VERSION_CONFLICT');assert.equal(p.nodes.get('budget-status').textContent,'');assert.equal(p.nodes.get('budget-save').disabled,false);
});
