'use strict';
const $=s=>document.querySelector(s),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=x=>Number(x).toLocaleString('zh-TW',{maximumFractionDigits:2}),sum=(rs,k)=>rs.reduce((a,r)=>a+Number(r[k]||0),0);
const adminPage=document.body.dataset.mode==='admin',cats=SEED.categories,groups=SEED.groups;
let state=structuredClone(Cloud.current),records=state.records,budgets=state.budgets,startDates=state.startDates,deletedRecords=state.deletedRecords||[],admin=false,page=1,sortKey='date',direction=-1,saveBusy=false,writing=false,deferredToasts=[];
let pivotGroups=[...groups],pivotMetrics=['approved','pending','remaining'];
const catName=id=>cats.find(c=>c.id===Number(id))?.name||'',startDate=g=>Ledger.start(SEED,startDates,g);
function currentState(){return {...state,records,budgets,startDates,deletedRecords}}
function applyState(value){if(Cloud.catalog)Object.assign(SEED,structuredClone(Cloud.catalog));state=structuredClone(value);records=state.records;budgets=state.budgets;startDates=state.startDates;deletedRecords=state.deletedRecords||[]}
function updateDataDate(){const raw=Cloud.updatedAt,date=raw?new Date(raw):null;const valid=date&&!Number.isNaN(date.getTime());$('#data-updated-date').textContent='資料更新日期：'+(valid?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(date):'—')}
function markFresh(){document.body.classList.remove('data-stale');$('#connection-banner').hidden=true;$('#cloud-status').textContent='雲端資料已同步';updateDataDate();if(!saveBusy)$('#expense-save').disabled=false}
function markStale(message='連線中斷，資料暫停顯示。恢復連線後會重新讀取雲端帳本。'){document.body.classList.add('data-stale');$('#cloud-status').textContent='尚未取得最新資料';$('#connection-message').textContent=message;$('#connection-banner').hidden=false;$('#expense-save').disabled=true;for(const id of ['group-detail','closeout-detail','matrix-audit'])if($('#'+id).open)$('#'+id).close();if($('#editor').open)$('#expense-budget-preview').textContent='資料尚未同步，無法儲存；請恢復連線後重試。'}
function enforceAuth(){if(admin&&!Cloud.canAdmin){admin=false;$('#editor').close();$('#budget-dialog').close();if(adminPage){document.body.classList.add('locked');if(!$('#login-dialog').open)$('#login-dialog').showModal()}}}
async function readLatest(){try{applyState(await Cloud.read());markFresh();enforceAuth()}catch(error){markStale();throw error}}
let writeQueue=Promise.resolve();
function writeChange(action){const requestedVersion=Number($('#editor').open?$('#editor').dataset.version||Cloud.version:$('#budget-dialog').open?$('#budget-dialog').dataset.version||Cloud.version:Cloud.version);const run=async()=>{
 if(!admin||!Cloud.canAdmin){enforceAuth();throw new Error('需要管理者登入')}
 const editorOpen=$('#editor').open,budgetOpen=$('#budget-dialog').open;let before;
 writing=true;deferredToasts=[];
 try{
  await readLatest();if(!Cloud.canAdmin)throw new Error('登入已過期，請重新登入');
  if(Cloud.version!==requestedVersion)throw new Error('帳本已被其他人更新，本次未儲存。請重新開啟編輯視窗後再操作。');
  before=structuredClone(currentState());await action();const after=currentState();
  if(JSON.stringify(before)!==JSON.stringify(after))applyState(await Cloud.commit(after));
  writing=false;markFresh();render();for(const message of deferredToasts)toast(message);
 }catch(error){writing=false;deferredToasts=[];if(before)applyState(before);try{await readLatest()}catch{}render();
  if(Cloud.canAdmin){if(editorOpen&&!$('#editor').open)$('#editor').showModal();if(budgetOpen&&!$('#budget-dialog').open)$('#budget-dialog').showModal()}enforceAuth();throw error;
 }finally{writing=false;deferredToasts=[]}
};writeQueue=writeQueue.catch(()=>{}).then(run);return writeQueue}
function options(items,all=true){return(all?'<option value="">全部</option>':'')+items.map(x=>`<option value="${esc(x.value??x)}">${esc(x.label??x)}</option>`).join('')}
function toast(message){if(writing){deferredToasts.push(message);return}$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,3500)}
function persist(){state={...currentState()};return true}
function budget(g,c){return c?Ledger.allocated(budgets,g,c)/100:cats.filter(x=>x.id!==12).reduce((n,x)=>n+Ledger.allocated(budgets,g,x.id),0)/100}
const executionRecords=rs=>rs.filter(r=>r.category!==12);
function used(g,c,from=startDate(g)){const dates={...startDates,[g]:from};return c?Ledger.spent(records,SEED,dates,g,c)/100:cats.filter(x=>x.id!==12).reduce((n,x)=>n+Ledger.spent(records,SEED,dates,g,x.id),0)/100}
function rate(n,d){return d>0?(n/d*100).toFixed(1)+'%':'—'}
// Header: all dates and all categories, including dedicated overseas travel.
// Only group spending in used() excludes dedicated travel and applies startDates.
function projectTotals(){const base=SEED.projectTotals;return {approved:base.approved,incurred:(records.reduce((n,r)=>n+Ledger.cents(r.incurred),0)-Ledger.cents(base.officeReclassifiedIncurred))/100,reimbursed:(records.reduce((n,r)=>n+Ledger.cents(r.reimbursed),0)-Ledger.cents(base.officeReclassifiedReimbursed))/100}}
function show(view){if(view==='pivot'&&!admin)return;document.querySelectorAll('.view').forEach(x=>x.hidden=x.id!==view);document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));const title=view==='pivot'?'經費樞紐分析':view==='overview'?'經費總覽':admin?'業務費明細管理':'支出明細';$('#crumb').textContent=title;$('#page-title').textContent=title}
$('#group').innerHTML=options([...new Set([...groups,...SEED.records.map(r=>r.group)])]);$('#category').innerHTML=options(cats.map(c=>({value:c.id,label:c.name})));$('#budget-group').innerHTML=options(groups,false);
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=async()=>{if(b.dataset.view==='pivot'){if(!admin)return;try{await readLatest();render()}catch(error){toast(error.message);return}}show(b.dataset.view)});
function filtered(){const q=$('#search').value.toLowerCase().trim(),from=$('#period').value==='custom'?$('#from').value:'',to=$('#period').value==='custom'?$('#to').value:'';return records.filter(r=>(!$('#group').value||r.group===$('#group').value)&&(!$('#category').value||r.category===Number($('#category').value))&&(!$('#requester').value||r.requester===$('#requester').value)&&(!q||[r.payee,r.requester,r.purpose,r.note].some(v=>String(v||'').toLowerCase().includes(q)))&&(!from||(r.date&&r.date>=from))&&(!to||(r.date&&r.date<=to))).sort((a,b)=>direction*(typeof a[sortKey]==='number'?a[sortKey]-b[sortKey]:String(a[sortKey]).localeCompare(String(b[sortKey]),'zh-TW'))||a.id.localeCompare(b.id))}
function currentPivot(){return Pivot.model(currentState(),SEED,pivotGroups,pivotMetrics)}
function renderPivot(){if(!adminPage||!admin)return;
 const result=currentPivot();$('#pivot-export').disabled=!result.groups.length&&!result.columns.length;
 $('#pivot-basis').textContent='核定金額與已核銷為全計畫金額；組別欄為各組累計起日起的期末待核銷。剩餘＝核定－已核銷－全組別期末待核銷合計。勾選只控制欄位顯示。';
 if(!result.groups.length&&!result.columns.length){$('#pivot-summary').textContent='請至少勾選一個要顯示的欄位。';$('#pivot-table').innerHTML='';return}
 $('#pivot-summary').textContent=`${result.groups.length}個組別　｜　${result.columns.length}個金額欄位　｜　${result.rows.length}個費用項目`;
 const cell=(value)=>`<td class="num ${value<0?'negative':''}">${money(value/100)}</td>`;
 const cells=row=>result.groups.map(g=>cell(row.byGroup[g].pending)).join('')+result.columns.map(m=>cell(row.total[m.id])).join('');
 $('#pivot-table').innerHTML=`<table class="pivot-table"><thead><tr><th scope="col">費用項目</th>${result.groups.map(g=>`<th class="num" scope="col">${esc(g)}<br>期末待核銷</th>`).join('')}${result.columns.map(m=>`<th class="num" scope="col">${m.label}</th>`).join('')}</tr></thead><tbody>${result.rows.map(r=>`<tr><th scope="row">${r.category} · ${esc(r.name)}</th>${cells(r)}</tr>`).join('')}<tr class="total-row"><th scope="row">合計</th>${cells(result.totals)}</tr></tbody></table>`;

}
if(adminPage){
 $('#pivot-groups').innerHTML=groups.map((g,i)=>`<label><input type="checkbox" data-pivot-group="${esc(g)}" checked>${esc(g)}</label>`).join('');
 $('#pivot-metrics').innerHTML=Pivot.metrics.map(m=>`<label><input type="checkbox" data-pivot-metric="${m.id}" ${pivotMetrics.includes(m.id)?'checked':''}>${m.label}</label>`).join('');
 $('#pivot-groups').addEventListener('change',e=>{const g=e.target.dataset.pivotGroup;if(!groups.includes(g))return;pivotGroups=e.target.checked?[...new Set([...pivotGroups,g])]:pivotGroups.filter(x=>x!==g);renderPivot()});
 $('#pivot-metrics').addEventListener('change',e=>{const id=e.target.dataset.pivotMetric;if(!Pivot.metrics.some(m=>m.id===id))return;pivotMetrics=e.target.checked?[...new Set([...pivotMetrics,id])]:pivotMetrics.filter(x=>x!==id);renderPivot()});
 function selectPivotGroups(all){pivotGroups=all?[...groups]:[];document.querySelectorAll('[data-pivot-group]').forEach(x=>x.checked=all);renderPivot()}
 $('#pivot-groups-all').onclick=()=>selectPivotGroups(true);$('#pivot-groups-none').onclick=()=>selectPivotGroups(false);
 $('#pivot-export').onclick=()=>{if(!admin)return;const result=currentPivot();if(!result.groups.length&&!result.columns.length)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([Pivot.csv(result)],{type:'text/csv;charset=utf-8'}));a.download='經費樞紐分析.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
}
function groupDetailRows(g){return cats.map(c=>{const amount=budget(g,c.id),incurred=used(g,c.id),reimbursed=records.filter(r=>r.group===g&&r.category===c.id&&(c.id===12||r.budgetReserved||r.origin==='manual'||String(r.id).startsWith('local-')||(r.date&&r.date>=startDate(g)))).reduce((total,r)=>total+Ledger.cents(r.reimbursed),0)/100;return {category:c.id,name:c.name,budget:amount,incurred,reimbursed,remaining:(Ledger.cents(amount)-Ledger.cents(incurred))/100}})}
function renderGroupDetail(){const g=$('#group-detail').dataset.group;if(!groups.includes(g))return;const rows=groupDetailRows(g),ordinary=rows.filter(r=>r.category!==12),totals=ordinary.reduce((t,r)=>{for(const k of ['budget','incurred','reimbursed','remaining'])t[k]+=Ledger.cents(r[k]);return t},{budget:0,incurred:0,reimbursed:0,remaining:0});
 $('#group-detail-title').textContent=g+'經費明細';$('#group-detail-period').textContent='累計起日（含當日）：'+startDate(g)+'　可用預算＝預算金額－已發生金額';
 const cells=r=>['budget','incurred','reimbursed','remaining'].map(k=>`<td class="num ${r[k]<0?'negative':''}">${money(r[k])}</td>`).join('');
 $('#group-detail-table').innerHTML=`<table><thead><tr><th>費用科目</th><th class="num">預算金額</th><th class="num">已發生金額</th><th class="num">已核銷金額</th><th class="num">可用預算</th></tr></thead><tbody>${rows.map(r=>`<tr><th scope="row">${r.category} · ${esc(r.name)}${r.category===12?'（專款專用）':''}</th>${cells(r)}</tr>`).join('')}<tr class="total-row"><th scope="row">一般預算合計</th>${cells(Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,v/100])))}</tr></tbody></table>`;
}
async function openGroupDetail(g){if(!groups.includes(g))return;try{await readLatest()}catch{toast('無法讀取資料，請重新整理');return}$('#group-detail').dataset.group=g;renderGroupDetail();$('#group-detail').showModal()}
$('#group-detail-close').onclick=()=>$('#group-detail').close();
function closeoutRows(){return cats.map(c=>{const allocated=groups.reduce((n,g)=>n+Ledger.allocated(budgets,g,c.id),0),paid=records.filter(r=>r.category===c.id&&groups.includes(r.group)&&r.date&&r.date>=startDate(r.group)).reduce((n,r)=>n+Ledger.cents(r.reimbursed),0);return {category:c.id,name:c.name,budget:allocated,paid,remaining:allocated-paid}})}
function renderCloseout(){const rows=closeoutRows(),total=rows.reduce((t,r)=>({budget:t.budget+r.budget,paid:t.paid+r.paid,remaining:t.remaining+r.remaining}),{budget:0,paid:0,remaining:0});const cells=r=>['budget','paid','remaining'].map(k=>`<td class="num ${r[k]<0?'negative':''}">${money(r[k]/100)}</td>`).join('');$('#closeout-table').innerHTML=`<table><thead><tr><th>費用科目</th><th class="num">各組預算總額</th><th class="num">已核銷總額</th><th class="num">期末待核銷小計</th></tr></thead><tbody>${rows.map(r=>`<tr><th scope="row">${r.category} · ${esc(r.name)}</th>${cells(r)}</tr>`).join('')}<tr class="total-row"><th scope="row">合計</th>${cells(total)}</tr></tbody></table>`}
$('#closeout-open').onclick=async()=>{if(!admin)return;try{await readLatest();renderCloseout();$('#closeout-detail').showModal()}catch(error){toast(error.message||'無法讀取資料，請重新整理')}};
$('#closeout-close').onclick=()=>$('#closeout-detail').close();
function matrixSubtotal(category){const remaining=groups.reduce((total,g)=>total+(category===12?Ledger.cents(used(g,category)):Ledger.cents(budget(g,category))-Ledger.cents(used(g,category))),0)/100;return `<td class="num ${remaining<0?'negative':''}"><strong>${money(remaining)}</strong></td>`}
function renderRecords(){const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/25));page=Math.min(page,pages);const unfiltered=rows.length===records.length,totals=unfiltered?projectTotals():{incurred:sum(rows,'incurred'),reimbursed:sum(rows,'reimbursed')};$('#record-summary').textContent=`${rows.length} 筆　｜　${unfiltered?'':'篩選明細原額　｜　'}已發生 ${money(totals.incurred)}　｜　已核銷 ${money(totals.reimbursed)}${unfiltered?'　｜　已排除執辦辦公室（含文具轉列）':''}`;
 const columns=[['date','日期'],['department','科部'],['category','科目'],['requester','請款人'],['payee','受款人'],['purpose','用途'],['incurred','已發生'],['reimbursed','已核銷']];
 $('#record-table').innerHTML=`<table><thead><tr>${columns.map(([k,l])=>`<th aria-sort="${sortKey===k?(direction===1?'ascending':'descending'):'none'}"><button data-sort="${k}">${l} ${sortKey===k?(direction===1?'↑':'↓'):'↕'}</button></th>`).join('')}${admin?'<th>操作</th>':''}</tr></thead><tbody>${rows.slice((page-1)*25,page*25).map(r=>`<tr><td>${esc(r.date||'未填')}</td><td>${esc(r.department||r.group)}</td><td>${esc(catName(r.category))}</td><td>${esc(r.requester)}</td><td>${esc(r.payee||'—')}</td><td class="purpose">${esc(r.purpose)}${r.note?`<div>${esc(r.note)}</div>`:''}</td><td class="num">${money(r.incurred)}</td><td class="num">${money(r.reimbursed)}</td>${admin?`<td><div class="row-actions"><button class="text-button" data-edit="${esc(r.id)}">編輯</button><button class="text-button danger" data-delete="${esc(r.id)}">刪除</button>${r.incurred>r.reimbursed?`<button class="text-button" data-pay="${esc(r.id)}">確認餘款已付款</button>`:''}</div></td>`:''}</tr>`).join('')||`<tr><td colspan="${admin?9:8}">沒有符合條件的資料</td></tr>`}</tbody></table>`;
 $('#page-info').textContent=`${page} / ${pages} 頁`;$('#prev').disabled=page===1;$('#next').disabled=page===pages;
}
function render(){updateDataDate();renderPivot();if($('#closeout-detail').open&&admin)renderCloseout();if($('#group-detail').open)renderGroupDetail();const t=projectTotals();$('#stats').innerHTML=[['核定總額',money(t.approved)],['已發生總額（全期間）',money(t.incurred)],['已核銷總額',money(t.reimbursed)],['執行率',rate(t.incurred,t.approved)]].map(([label,value],i)=>`<div class="stat ${i===3?'highlight':''}"><div>${label}</div><strong>${value}</strong></div>`).join('');
 const prev=$('#requester').value;$('#requester').innerHTML=options([...new Set(records.map(r=>r.requester).filter(Boolean))].sort());$('#requester').value=prev;
 $('#group-chart').innerHTML=groups.map(g=>{const b=budget(g),u=used(g),remaining=b-u,pct=b>0?u/b*100:0;return `<tr><th scope="row">${esc(g)}</th><td>${startDate(g)}</td><td class="num">${money(b)}</td><td class="num">${money(u)}</td><td class="num ${remaining<0?'negative':''}">${money(remaining)}</td><td><div class="progress-cell"><span class="${pct>100?'negative':''}">${rate(u,b)}</span><div class="track"><div class="bar ${pct>100?'over-budget':''}" style="width:${Math.min(100,Math.max(0,pct))}%"></div></div></div></td>${admin?`<td><button class="button" data-budget-group="${g}">調整預算</button></td>`:''}</tr>`}).join('');
 $('#matrix').innerHTML=`<table><thead><tr><th>費用科目</th>${groups.map(g=>`<th class="num"><button type="button" class="matrix-button" data-group-detail="${esc(g)}" aria-label="${esc(g)}預算明細">${esc(g)} ↗</button></th>`).join('')}${admin?'<th class="num">小計</th>':''}</tr></thead><tbody>${cats.map(c=>`<tr><th scope="row">${c.id} · ${esc(c.name)}</th>${groups.map(g=>{if(c.id===12)return `<td class="num"><button class="matrix-button" data-matrix="12" data-group="${g}">${money(used(g,12))}</button></td>`;const remaining=budget(g,c.id)-used(g,c.id);return `<td class="num"><button class="matrix-button ${remaining<0?'negative':''}" data-matrix="${c.id}" data-group="${g}" aria-label="${g}${esc(c.name)}可用預算${money(remaining)}，查看明細">${money(remaining)}</button></td>`}).join('')}${admin?(matrixSubtotal(c.id)):''}</tr>`).join('')}<tr class="total-row"><th>一般預算合計</th>${groups.map(g=>`<td class="num ${budget(g)-used(g)<0?'negative':''}">${money(budget(g)-used(g))}</td>`).join('')}${admin?matrixSubtotal():''}</tr></tbody></table>`;
 document.querySelectorAll('.admin-only').forEach(x=>x.hidden=!admin);$('#audit-restore').hidden=!admin;$('#budget-manage').hidden=!admin;$('#add').hidden=!admin;renderRecords();
}
function periodChanged(){const custom=$('#period').value==='custom';$('#from-label').hidden=!custom;$('#to-label').hidden=!custom;if(!custom){$('#from').value='';$('#to').value=''}page=1;renderRecords()}
document.querySelectorAll('.filters input,.filters select').forEach(x=>x.addEventListener('input',()=>{if(x.id==='period')periodChanged();else{page=1;renderRecords()}}));
$('#from').addEventListener('change',()=>{$('#to').min=$('#from').value;if($('#to').value&&$('#to').value<$('#from').value){$('#to').value='';toast('迄日不可早於起日')}renderRecords()});
$('#clear').onclick=()=>{document.querySelectorAll('.filters input,.filters select').forEach(x=>x.value='');$('#to').min='';periodChanged()};$('#prev').onclick=()=>{page--;renderRecords()};$('#next').onclick=()=>{page++;renderRecords()};
document.addEventListener('click',async e=>{
 const sort=e.target.closest('[data-sort]');if(sort){direction=sortKey===sort.dataset.sort?-direction:1;sortKey=sort.dataset.sort;renderRecords()}
 const detail=e.target.closest('[data-group-detail]');if(detail){openGroupDetail(detail.dataset.groupDetail);return}
 const matrix=e.target.closest('[data-matrix]');if(matrix){$('#group').value=matrix.dataset.group;$('#category').value=matrix.dataset.matrix;page=1;renderRecords();show('records')}
 const edit=e.target.closest('[data-edit]');if(edit&&admin)openEditor(records.find(r=>r.id===edit.dataset.edit));
 const bg=e.target.closest('[data-budget-group]');if(bg&&admin)openBudget(bg.dataset.budgetGroup);
 const del=e.target.closest('[data-delete]');
 if(del&&admin){const r=records.find(r=>r.id===del.dataset.delete);if(!r||!confirm(`確定刪除「${r.group}／${catName(r.category)}／${r.purpose}」${money(r.incurred)}元？刪除後會更新預算及統計。`))return;
  try{await writeChange(()=>{const latest=records.find(x=>x.id===r.id);if(!latest){render();return}const old=records,oldDeleted=deletedRecords;records=records.filter(x=>x.id!==r.id);deletedRecords=[...deletedRecords,{...latest,deletedAt:new Date().toISOString()}];if(!persist()){records=old;deletedRecords=oldDeleted;return}render();toast('支出已刪除，預算及統計已更新')})}catch(error){toast(error.message||'刪除失敗，請重新整理')}
 }
 const pay=e.target.closest('[data-pay]');
 if(pay&&admin){const r=records.find(x=>x.id===pay.dataset.pay);if(!r||!confirm(`確認此案件剩餘${money(r.incurred-r.reimbursed)}元已實際付款？確認後累計已核銷將等於已發生金額，不會新增支出或恢復可用預算。`))return;
  try{await writeChange(()=>{const old=records;records=records.map(x=>x.id===r.id?{...x,reimbursed:x.incurred}:x);if(persist()){render();toast('已確認付款並更新已核銷金額')}else records=old})}catch(error){toast(error.message||'更新付款失敗，請重新整理')}
 }
});
$('#manage').onclick=async()=>{if(adminPage&&admin){try{await Cloud.logout();location.href='index.html'}catch(error){toast(error.message)}}else location.href='admin.html'};
function unlock(){admin=true;document.body.classList.remove('locked');$('#manage').textContent='登出管理';render();show('overview')}
$('#login-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;if(button)button.disabled=true;try{
 const latest=await Cloud.login($('#login-account').value.trim(),$('#login-password').value);applyState(latest);$('#login-password').value='';$('#login-error').textContent='';$('#login-dialog').close();unlock();
}catch(error){$('#login-error').textContent=error.message;$('#login-password').value='';$('#login-password').focus()}finally{if(button)button.disabled=false}};
$('#login-dialog').addEventListener('cancel',e=>e.preventDefault());
async function openEditor(r){if(!admin)return;try{await readLatest()}catch{toast('無法讀取資料，請重新整理');return}if(r){r=records.find(x=>x.id===r.id);if(!r){toast('此紀錄已被刪除，請重新整理');return}}const f=$('#edit-form');f.reset();f.elements.id.value='';f.elements.group.innerHTML=options(groups,false);f.elements.category.innerHTML=options(cats.map(c=>({value:c.id,label:c.name})),false);$('#edit-title').textContent=r?'編輯支出':'新增支出';if(r)Object.keys(r).forEach(k=>{if(f.elements[k])f.elements[k].value=r[k]});else{f.elements.date.value=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});f.elements.incurred.value='';f.elements.reimbursed.value=0}$('#editor').dataset.version=String(Cloud.version);$('#editor').showModal();previewExpense()}
$('#add').onclick=()=>openEditor();$('#cancel').onclick=()=>$('#editor').close();
function expenseDraft(){const v=Object.fromEntries(new FormData($('#edit-form')));v.category=Number(v.category);v.incurred=Number(v.incurred);v.reimbursed=Number(v.reimbursed);return Ledger.prepare(v,records.find(r=>r.id===v.id))}
function previewExpense(){const v=expenseDraft();if(!groups.includes(v.group)||!cats.some(c=>c.id===v.category))return;const b=Ledger.balance(currentState(),SEED,v.group,v.category),bad=Ledger.check(currentState(),SEED,v);$('#expense-budget-preview').innerHTML=`<div>預算金額：${money(b.budget/100)}</div><div>已占用：${money(b.used/100)}</div><div class="num ${b.remaining<0?'negative':''}">可用預算：${money(b.remaining/100)}</div>${bad?'<p class="negative">超出可用預算，無法儲存。</p>':''}`}
$('#edit-form').addEventListener('input',previewExpense);
function showBudgetAlert(result){
 const remaining=result.allocated-result.current;
 $('#budget-alert-details').innerHTML=`<dl><dt>組別</dt><dd>${esc(result.group)}</dd><dt>費用科目</dt><dd>${esc(catName(result.category))}</dd><dt>預算金額</dt><dd>${money(result.allocated/100)}</dd><dt>目前已發生</dt><dd>${money(result.current/100)}</dd><dt>目前可用預算</dt><dd class="num ${remaining<0?'negative':''}">${money(remaining/100)}</dd><dt>本次新增占用</dt><dd>${money(result.increase/100)}</dd><dt>超出金額</dt><dd class="num negative">${money((result.projected-result.allocated)/100)}</dd></dl>`;
 $('#budget-alert').showModal();
}
$('#budget-alert-close').onclick=()=>$('#budget-alert').close();
$('#edit-form').onsubmit=async e=>{
 e.preventDefault();if(!admin||saveBusy)return;
 const raw=Object.fromEntries(new FormData(e.target));raw.category=Number(raw.category);raw.incurred=Number(raw.incurred);raw.reimbursed=Number(raw.reimbursed);
 saveBusy=true;$('#expense-save').disabled=true;
 try{await writeChange(()=>{
  const previous=records.find(r=>r.id===raw.id);if(raw.id&&!previous){toast('此紀錄已被刪除，請重新整理');return}
  const v=Ledger.prepare(raw,previous),error=Ledger.validate(SEED,v);if(error){toast(error);return}
  const violation=Ledger.check(currentState(),SEED,v);if(violation){showBudgetAlert(violation);previewExpense();return}
  const old=records,index=records.findIndex(r=>r.id===v.id);records=[...records];
  if(index>=0)records[index]={...records[index],...v};else records.push({...v,id:'local-'+crypto.randomUUID(),source:'本機新增',origin:'manual',budgetReserved:true});
  if(!persist()){records=old;return}$('#editor').close();render();toast('支出已儲存');
 })}catch(error){toast(error.message||'無法讀取最新預算，未儲存支出，請重新整理')}finally{saveBusy=false;$('#expense-save').disabled=false}
};
// Allocated budget is editable; incurred and remaining are derived values.
function fillBudget(){const g=$('#budget-group').value;$('#budget-start').value=startDate(g);$('#budget-error').textContent='';$('#budget-status').textContent='';$('#budget-inputs').innerHTML=cats.map(c=>{const b=budget(g,c.id),u=used(g,c.id);return `<tr data-category="${c.id}"><th scope="row">${esc(c.name)}</th><td><input data-allocated="${c.id}" type="number" min="0" step="0.01" value="${b}" required aria-label="${esc(c.name)}預算金額"></td><td class="num" data-used="${c.id}">${money(u)}</td><td class="num ${b-u<0?'negative':''}" data-remaining="${c.id}">${money(b-u)}</td></tr>`}).join('')}
async function openBudget(g=groups[0]){if(!admin)return;try{await readLatest()}catch(error){toast(error.message);return}$('#budget-group').value=g;fillBudget();$('#budget-dialog').dataset.version=String(Cloud.version);$('#budget-dialog').showModal()}
$('#budget-manage').onclick=()=>openBudget();$('#budget-cancel').onclick=()=>$('#budget-dialog').close();
$('#budget-group').onchange=()=>{if($('#budget-dialog').dataset.dirty==='yes'&&!confirm('切換組別將放棄未儲存的修改，是否繼續？')){$('#budget-group').value=$('#budget-dialog').dataset.group;return}fillBudget();$('#budget-dialog').dataset.dirty='';$('#budget-dialog').dataset.group=$('#budget-group').value;$('#budget-dialog').dataset.version=String(Cloud.version)};
$('#budget-dialog').addEventListener('close',()=>{$('#budget-dialog').dataset.dirty=''});
$('#budget-dialog').addEventListener('input',e=>{if(e.target.id==='budget-group')return;const g=$('#budget-group').value,date=$('#budget-start').value;if(!date)return;$('#budget-dialog').dataset.dirty='yes';$('#budget-dialog').dataset.group=g;if(e.target.id==='budget-start'||e.target.matches('[data-allocated]')){document.querySelectorAll('[data-allocated]').forEach(input=>{const c=Number(input.dataset.allocated),u=used(g,c,date);$(`[data-used="${c}"]`).textContent=money(u);const remaining=Number(input.value)-u;$(`[data-remaining="${c}"]`).textContent=money(remaining);$(`[data-remaining="${c}"]`).classList.toggle('negative',remaining<0)})}});
function setBudgetSaving(busy){$('#budget-save').disabled=busy;$('#budget-group').disabled=busy;$('#budget-start').disabled=busy;document.querySelectorAll('[data-allocated]').forEach(x=>x.disabled=busy)}
$('#budget-form').onsubmit=async e=>{
 e.preventDefault();if(!admin||saveBusy)return;
 const g=$('#budget-group').value,date=$('#budget-start').value,entries=[...document.querySelectorAll('[data-allocated]')].map(x=>({group:g,category:Number(x.dataset.allocated),amount:Number(x.value)}));
 if(!groups.includes(g)||!date||entries.some(x=>!Number.isFinite(x.amount)||x.amount<0)){$('#budget-error').textContent='請確認組別、日期及非負數預算金額';return}
 saveBusy=true;setBudgetSaving(true);$('#budget-error').textContent='';$('#budget-status').textContent='儲存中…';
 try{
  await writeChange(()=>{budgets=[...budgets.filter(x=>x.group!==g),...entries];startDates={...startDates,[g]:date};persist()});
  $('#budget-group').value=g;fillBudget();$('#budget-dialog').dataset.version=String(Cloud.version);$('#budget-dialog').dataset.dirty='';$('#budget-dialog').dataset.group=g;
  $('#budget-status').textContent=g+'預算與累計起日已儲存';
 }catch(error){$('#budget-status').textContent='';$('#budget-error').textContent=error.message||'儲存預算失敗，請重新整理'}
 finally{saveBusy=false;setBudgetSaving(false)}
};

$('#export').onclick=()=>{const columns=['date','department','category','requester','payee','purpose','incurred','reimbursed','note'];const safe=v=>{let x=String(v??'');if(/^[=+@\-\t\r]/.test(x))x="'"+x;return '"'+x.replace(/"/g,'""')+'"'};const csv='\uFEFF'+[['日期','科部','科目','請款人','受款人','用途','已發生','已核銷','備註'].map(safe).join(','),...filtered().map(r=>columns.map(k=>safe(k==='category'?catName(r[k]):r[k])).join(','))].join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='範疇二_篩選明細.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
function renderMatrixAudit(){
 const all=Ledger.matrixAudit(currentState(),SEED),g=$('#audit-group').value,rows=all.filter(r=>r.group===g&&($('#audit-filter').value!=='different'||r.difference!==0));
 const totalDiff=all.filter(r=>r.difference!==0).length;
 const example=all.find(r=>r.group==='師培'&&r.category===1);
 $('#audit-summary').textContent=`已核對${all.length}格一般預算，${totalDiff}格與Excel基準不同。${example?'師培院內鐘點費的Excel可用基準為'+money(example.remaining)+'元。':''}`;
 $('#audit-table').innerHTML=`<table><thead><tr><th>科目</th><th class="num">Excel預算</th><th class="num">Excel已發生</th><th class="num">Excel可用</th><th class="num">目前可用</th><th class="num">差額</th><th>差異原因</th></tr></thead><tbody>${rows.map(r=>`<tr><th>${esc(catName(r.category))}</th><td class="num">${money(r.budget)}</td><td class="num">${money(r.incurred)}</td><td class="num ${r.remaining<0?'negative':''}">${money(r.remaining)}</td><td class="num ${r.actualRemaining<0?'negative':''}">${money(r.actualRemaining)}</td><td class="num ${r.difference<0?'negative':''}">${money(r.difference)}</td><td>${esc(r.reasons.join('；')||'一致')}</td></tr>`).join('')||'<tr><td colspan="7">此組沒有差異</td></tr>'}</tbody></table>`;
 const cache=all.filter(r=>r.cachedRemaining!==null&&r.cachedRemaining!==r.remaining);
 $('#audit-cache-note').textContent=`Excel原檔有${cache.length}格儲存的舊結果與明細不同，本頁使用明細重新計算。國外旅費為專款，不列入一般可用預算。`;
 $('#audit-restore').hidden=!admin;
}
$('#audit-group').innerHTML=options(groups,false);$('#audit-group').onchange=renderMatrixAudit;$('#audit-filter').onchange=renderMatrixAudit;
$('#audit-close').onclick=()=>$('#matrix-audit').close();
$('#audit-restore').onclick=()=>toast('正式版請透過受控資料匯入更新來源。');
$('#toast').hidden=true;
render();document.body.classList.remove('cloud-loading');
if(adminPage){if(Cloud.canAdmin)unlock();else{document.body.classList.add('locked');$('#login-dialog').showModal()}}
let syncing=false;
async function syncCloud(force=false){if(syncing||writing||saveBusy||document.hidden)return;
 syncing=true;try{await readLatest();if(adminPage&&Cloud.canAdmin&&!admin){if($('#login-dialog').open)$('#login-dialog').close();unlock()}render();if($('#editor').open)previewExpense()}
 catch{markStale()}finally{syncing=false}
}
$('#connection-retry').onclick=()=>syncCloud(true);
setInterval(()=>{if(!document.hidden&&Cloud.lastSuccess&&Date.now()-Cloud.lastSuccess>45000)markStale('資料尚未同步，正在重新連線。');syncCloud()},15000);
window.addEventListener('focus',()=>{markStale('正在重新取得最新資料。');syncCloud(true)});
window.addEventListener('pageshow',()=>{markStale('正在重新取得最新資料。');syncCloud(true)});
window.addEventListener('online',()=>syncCloud(true));
window.addEventListener('offline',()=>markStale());
document.addEventListener('visibilitychange',()=>{if(!document.hidden){markStale('正在重新取得最新資料。');syncCloud(true)}});
Cloud.client?.auth.onAuthStateChange(()=>{setTimeout(()=>syncCloud(true),0)});
setInterval(checkRelease,60000);
async function checkRelease(){if(document.hidden||writing||saveBusy||$('#editor').open||$('#budget-dialog').open)return;try{const response=await fetch('release.json?t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok)return;const remote=await response.json();if(remote.bundle&&remote.bundle!==window.APP_BUNDLE){markStale('網站程式已更新，請重新載入以使用最新版本。');$('#connection-retry').textContent='重新載入';$('#connection-retry').onclick=()=>location.reload()}}catch{}}
