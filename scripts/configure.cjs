const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const context={window:{}};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../web/config.js'),'utf8'),context);
const existing=context.window.APP_CONFIG;
const config={supabaseUrl:'https://dixtljbocpdjrgczbqjr.supabase.co',publishableKey:process.env.SUPABASE_PUBLISHABLE_KEY||existing.publishableKey||'',adminLoginAlias:'261524',adminLoginEmail:process.env.SUPABASE_ADMIN_LOGIN_EMAIL||existing.adminLoginEmail||''};
if(!config.publishableKey)throw Error('Set SUPABASE_PUBLISHABLE_KEY to the public publishable/anon key.');
if(config.publishableKey.startsWith('sb_secret_'))throw Error('Secret keys must never enter the frontend.');
if(config.publishableKey.includes('.')){const body=JSON.parse(Buffer.from(config.publishableKey.split('.')[1],'base64url'));if(body.role!=='anon')throw Error('Only anon JWT keys may enter the frontend.');}
fs.writeFileSync(path.resolve(__dirname,'../web/config.js'),'window.APP_CONFIG = Object.freeze('+JSON.stringify(config,null,2)+');\n');
console.log('Public connection configuration updated. No credentials were printed.');
