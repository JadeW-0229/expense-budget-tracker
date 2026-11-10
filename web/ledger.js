'use strict';
const SCHEMA=9,CORRECTION=9,cents=n=>Math.round((Number(n)+Number.EPSILON)*100),key=b=>b.group+'|'+b.category;
const copy=o=>JSON.parse(JSON.stringify(o));
function start(seed,dates,group){return dates[group]||seed.defaultStartDates?.[group]||'2026-07-24'}
function charge(record,seed,dates,group,category){
 if(!record||record.group!==group||record.category!==category)return 0;
 const reserved=record.budgetReserved||record.origin==='manual'||String(record.id).startsWith('local-');
 return category===12||reserved||(record.date&&record.date>=start(seed,dates,group))?cents(record.incurred):0;
}
function spent(records,seed,dates,group,category){return records.reduce((n,r)=>n+charge(r,seed,dates,group,category),0)}
function allocated(budgets,group,category){return budgets.filter(b=>b.group===group&&b.category===category).reduce((n,b)=>n+cents(b.amount),0)}
function balance(state,seed,group,category){const budget=allocated(state.budgets,group,category),used=spent(state.records,seed,state.startDates,group,category);return {budget,used,remaining:budget-used}}
function matrixAudit(state,seed){return (seed.budgetAudit||[]).map(source=>{
 const actual=balance(state,seed,source.group,source.category),expected=cents(source.remaining),reasons=[];
 if(actual.budget!==cents(source.budget))reasons.push('預算已調整');
 if(start(seed,state.startDates,source.group)!==source.startDate)reasons.push('累計起日不同');
 if(actual.used!==cents(source.incurred))reasons.push('支出有新增、編輯或刪除');
 return {...source,actualBudget:actual.budget/100,actualIncurred:actual.used/100,actualRemaining:actual.remaining/100,difference:(actual.remaining-expected)/100,reasons};
})}
function restoreGroup(state,seed,group){
 if(!seed.groups.includes(group))throw Error('Invalid group');
 const ids=new Set([...seed.records.filter(r=>r.group===group),...state.records.filter(r=>r.group===group),...state.deletedRecords.filter(r=>r.group===group)].map(r=>r.id));
 return {...state,records:[...state.records.filter(r=>!ids.has(r.id)),...seed.records.filter(r=>ids.has(r.id)).map(r=>({...r}))],budgets:[...state.budgets.filter(b=>b.group!==group),...seed.budgets.filter(b=>b.group===group).map(b=>({...b}))],startDates:{...state.startDates,[group]:start(seed,{},group)},deletedRecords:state.deletedRecords.filter(r=>!ids.has(r.id))};
}
function financiallyChanged(old,r){return !old||['group','category','date','incurred'].some(k=>String(old[k])!==String(r[k]))}
function prepare(record,previous){if(record.category===12)record={...record,group:'教學部',originalDepartment:previous?.originalDepartment||record.department||record.group};return {...record,department:record.group,budgetReserved:!!previous?.budgetReserved||financiallyChanged(previous,record),origin:previous?.origin||(!previous?'manual':'excel')}}
function check(state,seed,candidate){
 const previous=state.records.find(r=>r.id===candidate.id),g=candidate.group,c=candidate.category;
 const b=balance(state,seed,g,c),increase=charge(candidate,seed,state.startDates,g,c)-charge(previous,seed,state.startDates,g,c),projected=b.used+increase;
 return increase>0&&projected>b.budget?{group:g,category:c,allocated:b.budget,current:b.used,increase,projected}:null;
}
function validate(seed,r){
 if(!seed.groups.includes(r.group)||!seed.categories.some(c=>c.id===r.category))return '組別或科目無效，請重新選擇';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||!Number.isFinite(Date.parse(r.date)))return '請輸入有效日期';
 if(!r.requester?.trim()||!r.purpose?.trim())return '請填寫請款人與用途';
 if(!Number.isFinite(r.incurred)||!Number.isFinite(r.reimbursed)||r.incurred<0||r.reimbursed<0||r.reimbursed>r.incurred)return '請確認金額，已核銷不可超過已發生';
 if(!r.id&&r.incurred<=0)return '新增支出金額必須大於0';
 if(Math.abs(r.incurred*100-cents(r.incurred))>0.00001||Math.abs(r.reimbursed*100-cents(r.reimbursed))>0.00001)return '金額最多輸入小數2位';
 return null;
}
function mergeFields(current,oldSource,newSource){
 const out={...newSource};if(!current)return out;
 // If a source cell changed in the updated workbook, Excel wins. Preserve
 // explicit local edits only in fields unchanged in that workbook update.
 for(const k of Object.keys(current))if(!oldSource||JSON.stringify(newSource[k])===JSON.stringify(oldSource[k]))out[k]=current[k];
 out.group=newSource.group;out.department=newSource.department;return out;
}
function reconcile(saved,seed){
 saved=saved||{};
 // A one-time, explicitly requested correction: archive legacy browser state
 // before this function is committed, then use the authoritative Excel baseline.
 // Subsequent version-9 user transactions are preserved normally.
 if(requiresCorrection(saved))saved={};
 const changed=saved.sourceRevision!==seed.revision,oldRecords=saved.records||[],oldById=new Map(oldRecords.map(r=>[r.id,r]));
 const oldBaseline=new Map((saved.sourceRecords||seed.previousSource?.records||[]).map(r=>[r.id,r]));
 const fullRefresh=!!seed.fullDetailsVersion&&saved.fullDetailsVersion!==seed.fullDetailsVersion;
 const deletedRecords=copy(saved.deletedRecords||[]).filter(r=>!fullRefresh||!String(r.id).startsWith('excel-')),deleted=new Set(deletedRecords.map(r=>r.id));
 const records=seed.records.filter(r=>!deleted.has(r.id)).map(r=>{
  const existing=oldById.get(r.id);
  const row=fullRefresh?{...r}:changed?mergeFields(existing,oldBaseline.get(r.id),r):{...r,...existing};
  if((saved.schemaVersion||0)<SCHEMA){row.group=r.group;row.department=r.department}
  return row;
 });
 const seedIds=new Set(seed.records.map(r=>r.id));
 for(const r of oldRecords)if(!seedIds.has(r.id)&&(String(r.id).startsWith('local-')||r.origin==='manual')&&!deleted.has(r.id))records.push({...r,origin:'manual',budgetReserved:true,department:r.group});
 for(const r of records)if(r.category===12){r.originalDepartment=r.originalDepartment||r.department;r.group=r.department='教學部'}
 const oldBudget=new Map((saved.budgets||[]).map(b=>[key(b),b])),sourceBudget=new Map((saved.sourceBudgets||seed.previousSource?.budgets||[]).map(b=>[key(b),b]));
 const budgets=seed.budgets.map(b=>{const local=oldBudget.get(key(b)),base=sourceBudget.get(key(b));return changed&&base&&base.amount!==b.amount?{...b}:{...b,...local}});
 return {fullDetailsVersion:seed.fullDetailsVersion,schemaVersion:SCHEMA,correctionVersion:CORRECTION,sourceRevision:seed.revision,records,budgets,startDates:{...saved.startDates},deletedRecords,sourceRecords:copy(seed.records),sourceBudgets:copy(seed.budgets)};
}
function requiresCorrection(saved){return !!saved?.records&&(saved.correctionVersion||0)<CORRECTION}
const api={SCHEMA,CORRECTION,requiresCorrection,cents,start,charge,spent,allocated,balance,matrixAudit,restoreGroup,prepare,check,validate,reconcile};
export default api;
