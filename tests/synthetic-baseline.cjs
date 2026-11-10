// Synthetic CI fixture. No real requesters, purposes or transaction details.
module.exports=function(){
 const groups=['師培','人事室','醫學研究部','基因醫學部','EdTech','急重難','視覺化中心','教學部'];
 const categories=Array.from({length:21},(_,i)=>({id:i+1,name:'測試科目'+(i+1)}));
 const defaultStartDates=Object.fromEntries(groups.map(g=>[g,g==='教學部'?'2026-09-01':'2026-07-24']));
 const catalog={source:'synthetic CI fixture',revision:'synthetic',groups,categories,defaultStartDates,
  projectTotals:{approved:13298980,officeReclassifiedIncurred:3900,officeReclassifiedReimbursed:3900},budgetAudit:[]};
 const record=(id,g,c,date,incurred,reimbursed)=>({id,group:g,department:g,category:c,date,incurred,reimbursed,requester:'合成測試',purpose:'合成測試',source:'synthetic'});
 const records=[record('excel-1','師培',1,'2026-08-01',22000,22000),record('excel-2','教學部',3,'2026-01-01',7447733,6353641),record('excel-3','教學部',12,'2026-01-01',1,0),
  ...Array.from({length:350},(_,i)=>record('excel-zero-'+i,'師培',4,'',0,0))];
 const budgets=categories.flatMap(c=>groups.map(g=>({group:g,category:c.id,amount:g==='師培'&&c.id===1?23000:0})));
 return {catalog,state:{records,budgets,startDates:defaultStartDates,deletedRecords:[],sourceRevision:'synthetic'}};
};
