import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const filename=process.argv[2];if(!filename)throw new Error('Usage: node upload-firebase-secrets.mjs /path/to/service-account.json');
const account=JSON.parse(readFileSync(filename,'utf8'));
if(account.project_id!=='bowling-tracker-aad74'||!account.client_email||!account.private_key)throw new Error('Choose the JSON key for the bowling-tracker-aad74 service account.');
for(const [name,value] of [['GOOGLE_CLIENT_EMAIL',account.client_email],['GOOGLE_PRIVATE_KEY',account.private_key]]){
 const result=spawnSync(process.platform==='win32'?'npx.cmd':'npx',['wrangler@4','secret','put',name],{input:value,stdio:['pipe','inherit','inherit'],shell:false});
 if(result.status!==0)throw new Error(`Could not upload ${name}; check Cloudflare login.`);
}
console.log('Firebase credentials uploaded to Cloudflare secrets. No credentials were copied into the project.');
