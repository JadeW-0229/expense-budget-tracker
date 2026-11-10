const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),esbuild=require('esbuild');
const root=path.resolve(__dirname,'..'),web=path.join(root,'web'),dist=path.join(root,'dist');
async function build(){
 fs.mkdirSync(dist,{recursive:true});
 const entry=`import {connectCloud} from './cloud.js';\nwindow.APP_BUNDLE=document.currentScript?.src.split('/').pop();\nconnectCloud().then(Cloud=>{\nwindow.SEED={...Cloud.catalog,records:structuredClone(Cloud.current.records),budgets:structuredClone(Cloud.current.budgets)};\n${fs.readFileSync(path.join(web,'ledger.js'),'utf8')}\n${fs.readFileSync(path.join(web,'app.js'),'utf8')}\n}).catch(error=>{document.body.className='';document.body.replaceChildren();const box=document.createElement('p');box.style.padding='32px';box.setAttribute('role','alert');box.textContent=error.message;const retry=document.createElement('button');retry.className='button';retry.textContent='重新連線';retry.onclick=()=>location.reload();box.append(document.createElement('br'),retry);document.body.append(box);});`;
 const result=await esbuild.build({stdin:{contents:entry,resolveDir:web,sourcefile:'cloud-entry.js'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',minify:true});
 const js=result.outputFiles[0].contents,hash=crypto.createHash('sha256').update(js).digest('hex').slice(0,12),file=`app-${hash}.js`;
 fs.writeFileSync(path.join(dist,file),js);
 const css=fs.readFileSync(path.join(web,'styles.css'));fs.writeFileSync(path.join(dist,'styles.css'),css);
 const cssHash=crypto.createHash('sha256').update(css).digest('hex').slice(0,12);
 const config=fs.readFileSync(path.join(web,'config.js')),configHash=crypto.createHash('sha256').update(config).digest('hex').slice(0,12),configName=`config-${configHash}.js`;
 fs.writeFileSync(path.join(dist,configName),config);
 for(const name of ['index.html','admin.html']){
  const html=fs.readFileSync(path.join(web,name),'utf8').replace('app.bundle.js',file).replace('src="config.js"',`src="${configName}"`).replace(/styles\.css\?v=[^"\s]+/g,`styles.css?v=${cssHash}`);
  fs.writeFileSync(path.join(dist,name),html);
 }
 fs.writeFileSync(path.join(dist,'release.json'),JSON.stringify({bundle:file}));
 fs.writeFileSync(path.join(dist,'.nojekyll'),'');
 fs.writeFileSync(path.join(root,'build-manifest.json'),JSON.stringify({bundle:file,sha256:crypto.createHash('sha256').update(js).digest('hex'),source:'20261109',storage:'Supabase; no local ledger fallback'},null,2));
 console.log('Cloud static build complete: '+file);
}
build().catch(error=>{console.error(error.message);process.exitCode=1});
