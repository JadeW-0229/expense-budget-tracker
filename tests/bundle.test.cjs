const {test,before}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const root=path.resolve(__dirname,'..'),baseline=require('./synthetic-baseline.cjs')();
let manifest;
before(async()=>{await require('../scripts/build.cjs').build();manifest=JSON.parse(fs.readFileSync(path.join(root,'build-manifest.json'),'utf8'))});

async function packagedPage(file){
 const html=fs.readFileSync(path.join(root,'dist',file),'utf8');
 assert(html.includes(manifest.bundle));
 const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1])),nodes=new Map(),failures=[],storage=new Map();
 const get=id=>{assert(ids.has(id),id);if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',hidden:false,open:false,disabled:false,dataset:{},classList:{add(){},remove(){},toggle(){}},addEventListener(){},showModal(){this.open=true},close(){this.open=false},focus(){}});return nodes.get(id)};
 const document={hidden:false,visibilityState:'visible',currentScript:{src:'https://example.invalid/'+manifest.bundle},addEventListener(){},body:{dataset:file==='admin.html'?{mode:'admin'}:{},className:'cloud-loading',classList:{add(){},remove(){}},replaceChildren(){failures.push('body replaced by startup error')},append(box){failures.push(box.textContent)}},querySelector:s=>get(s.slice(1)),querySelectorAll:()=>[],createElement:()=>({style:{},setAttribute(){},append(){},textContent:''})};
 const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 const context={document,console,localStorage,sessionStorage:localStorage,location:{href:'https://example.invalid/'+file,protocol:'https:',host:'example.invalid',hostname:'example.invalid',hash:'',search:'',reload(){}},navigator:{userAgent:'bundle-smoke-test',onLine:true},crypto:webcrypto,URL,URLSearchParams,Headers,Request,Response,AbortController,AbortSignal,TextEncoder,TextDecoder,structuredClone,atob,btoa,performance,setTimeout,clearTimeout,setInterval:()=>0,clearInterval(){},addEventListener(){},removeEventListener(){},WebSocket:globalThis.WebSocket};
 context.fetch=async(input)=>{const url=typeof input==='string'?input:input.url;
  assert(url.includes('/rest/v1/rpc/expense_snapshot'),'Unexpected startup network operation: '+url);
  return new Response(JSON.stringify({version:1,catalog:baseline.catalog,state:baseline.state,canAdmin:false,updatedAt:'2026-11-09T16:30:00Z'}),{status:200,headers:{'Content-Type':'application/json'}});
 };
 context.window=context;context.self=context;vm.createContext(context);
 const configScript=[...html.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]).find(x=>x.startsWith('config-'));
 vm.runInContext(fs.readFileSync(path.join(root,'dist',configScript),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(root,'dist',manifest.bundle),'utf8'),context);
 for(let i=0;i<100;i++){await new Promise(resolve=>setTimeout(resolve,10));if(failures.length||nodes.get('stats')?.innerHTML)break}
 assert.deepEqual(failures,[],'Minified production startup must not throw');
 assert(nodes.get('stats')?.innerHTML.includes('7,465,834'),'Packaged page must render cloud incurred total');
 assert(nodes.get('stats')?.innerHTML.includes('6,371,741'));
 assert.equal(nodes.get('data-updated-date')?.textContent,'資料更新日期：2026-11-10');
 return {nodes,context};
}
test('actual minified Viewer starts with SDK and cloud HTTP, without injected Ledger or SEED',async()=>{
 const p=await packagedPage('index.html');assert(p.nodes.get('record-table').innerHTML.includes('<table>'));
});
test('actual minified admin renders data and opens login, without injected Ledger or SEED',async()=>{
 const p=await packagedPage('admin.html');assert.equal(p.nodes.get('login-dialog').open,true);
});
