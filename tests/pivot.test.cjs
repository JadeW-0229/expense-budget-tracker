const {test,before}=require('node:test'),assert=require('node:assert/strict');
let Pivot;before(async()=>{({default:Pivot}=await import('../web/pivot.js'))});
const catalog={groups:['甲組','乙組','教學部'],categories:[{id:1,name:'鐘點費'},{id:21,name:'權利使用費'}],categoryApproved:{'1':10000,'21':300000},defaultStartDates:{'甲組':'2026-07-24','乙組':'2026-09-01','教學部':'2026-09-01'}};
const state=()=>({budgets:[{group:'甲組',category:1,amount:1000},{group:'乙組',category:1,amount:2000},{group:'乙組',category:21,amount:293000}],startDates:{},records:[
 {id:'excel-before',group:'甲組',category:1,date:'2026-07-23',incurred:100,reimbursed:100},
 {id:'excel-boundary',group:'甲組',category:1,date:'2026-07-24',incurred:500,reimbursed:300},
 {id:'excel-b-before',group:'乙組',category:1,date:'2026-08-31',incurred:250,reimbursed:250},
 {id:'excel-b-boundary',group:'乙組',category:1,date:'2026-09-01',incurred:1000,reimbursed:700},
 {id:'excel-rights',group:'乙組',category:21,date:'2026-10-22',incurred:145000,reimbursed:145000}
]});
test('user rights example: plan approved 300000 minus paid 145000 minus pending 148000 equals 7000',()=>{
 const r=Pivot.model(state(),catalog,catalog.groups,['approved','paid','pending','remaining']);const v=r.rows.find(x=>x.category===21).total;
 assert.deepEqual(v,{approved:30000000,paid:14500000,pending:14800000,remaining:700000});
});
test('group columns use each cutoff inclusive; plan paid includes all dates and is not repeated per group',()=>{
 const r=Pivot.model(state(),catalog,['乙組','甲組'],['remaining','approved']);assert.deepEqual(r.groups,['甲組','乙組']);assert.deepEqual(r.columns.map(m=>m.id),['approved','remaining']);
 assert.equal(r.rows[0].byGroup['甲組'].pending,70000);assert.equal(r.rows[0].byGroup['乙組'].pending,130000);
 assert.deepEqual(r.rows[0].total,{approved:1000000,paid:135000,pending:200000,remaining:665000});
});
test('hiding a group only changes visible columns, never the full-plan totals',()=>{
 const s=state(),all=Pivot.model(s,catalog,catalog.groups,['remaining']),one=Pivot.model(s,catalog,['甲組'],['remaining']);assert.deepEqual(all.rows.map(r=>r.total),one.rows.map(r=>r.total));assert.deepEqual(all.totals.total,one.totals.total);
});
test('negative remaining is preserved and stationery office transfer matches the main net paid total',()=>{
 const c={groups:['甲組'],categories:[{id:9,name:'文具紙張'}],categoryApproved:{'9':100},projectTotals:{officeReclassifiedReimbursed:3900},defaultStartDates:{'甲組':'2026-07-24'}};
 const s={budgets:[{group:'甲組',category:9,amount:6000}],startDates:{},records:[{group:'甲組',category:9,date:'2026-08-01',incurred:5000,reimbursed:5000}]};
 const r=Pivot.model(s,c,['甲組'],['paid','pending','remaining']);assert.equal(r.rows[0].total.paid,110000);assert.equal(r.rows[0].total.pending,100000);assert.equal(r.rows[0].total.remaining,-200000);
});
test('metrics-only, group-only and empty selections work; CSV includes exactly visible columns',()=>{
 const s=state(),before=JSON.stringify(s);const onlyMetrics=Pivot.model(s,catalog,[],['approved','remaining']);assert.equal(onlyMetrics.columns.length,2);assert.equal(onlyMetrics.groups.length,0);
 const r=Pivot.model(s,catalog,['甲組'],['approved','pending']),csv=Pivot.csv(r);assert(csv.startsWith('\uFEFF'));assert(csv.includes('甲組／期末待核銷'));assert(!csv.includes('乙組／'));assert(!csv.includes('剩餘金額'));assert.equal(csv.split('\r\n')[0].split(',').length,4);assert.equal(JSON.stringify(s),before);
 const onlyGroup=Pivot.model(s,catalog,['甲組'],[]);assert.equal(onlyGroup.columns.length,0);assert.equal(onlyGroup.groups.length,1);
});
test('missing plan approved amount fails explicitly rather than silently reporting zero',()=>{
 const c={...catalog,categoryApproved:{'1':10000}};assert.throws(()=>Pivot.model(state(),c,c.groups,['approved']),/核定金額/);
});
