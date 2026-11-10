// Prepare explicit upload manifests. Do not enumerate ignored/private directories.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const files=['README.md','AGENTS.md','.gitignore','package.json','package-lock.json',
 '.github/workflows/validate.yml','.github/workflows/deploy-pages.yml',
 'scripts/build.cjs','scripts/configure.cjs','scripts/prepare-import.cjs','scripts/package-release.cjs',
 'web/index.html','web/admin.html','web/styles.css','web/app.js','web/ledger.js','web/cloud.js','web/config.js',
 'supabase/migrations/202611090001_expense_ledger.sql',
 'supabase/migrations/202611100001_audit_index.sql',
 'supabase/migrations/202611100002_request_status.sql',
 'supabase/migrations/202611100003_admin_provisioning.sql',
 'tests/cloud.test.cjs','tests/database.test.cjs','tests/synthetic-baseline.cjs','tests/bundle.test.cjs'];
const entries=files.map(name=>{const content=fs.readFileSync(path.join(root,name),'utf8');return {path:name,sha256:crypto.createHash('sha256').update(content).digest('hex'),bytes:Buffer.byteLength(content)}});
fs.writeFileSync(path.join(root,'upload-manifest.json'),JSON.stringify({repository:'JadeW-0229/expense-budget-tracker',files:entries},null,2));
console.log('Upload manifest ready: '+entries.length+' code/schema files; no actual expense data or private import.');
