import {readFileSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

const [environment,action]=process.argv.slice(2);
if(!['staging','production'].includes(environment)||!['dev','build','start'].includes(action))throw Error('Ambiente o acción inválidos.');
const file=`.env.${environment}.local`;
let config;
try{config=parseEnv(readFileSync(file,'utf8'));}catch{throw Error(`Completa ${file} antes de continuar.`);}
if(config.VVN_ENVIRONMENT!==environment)throw Error(`${file} no corresponde al ambiente solicitado.`);
for(const key of ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY','VVN_EXPECTED_SUPABASE_PROJECT_REF','VVN_BRAND_ID','BRAND_OPERATOR_EMAIL','BRAND_OPERATOR_PASSWORD','RATING_SALT'])
 if(!config[key]||/replace-with|PENDIENTE/.test(config[key]))throw Error(`Falta completar ${key} en ${file}.`);
if(config.NEXT_PUBLIC_SUPABASE_URL!==`https://${config.VVN_EXPECTED_SUPABASE_PROJECT_REF}.supabase.co`)throw Error('La URL no corresponde al proyecto esperado.');
if((environment==='staging')!==(config.VVN_EXPECTED_SUPABASE_PROJECT_REF==='msfrkqfvdhyjnktwuhzd'))throw Error('El proyecto Supabase no corresponde al ambiente solicitado.');
// Sobrescribir también opcionales ausentes: Next no debe heredarlos de otro dotenv.
const keys=new Set([...Object.keys(parseEnv(readFileSync('.env.example','utf8'))),
 ...Object.keys(config),'NEXT_PUBLIC_SUPABASE_ANON_KEY','KV_REST_API_URL','KV_REST_API_TOKEN',
 'UPSTASH_REDIS_REST_KV_REST_API_URL','UPSTASH_REDIS_REST_KV_REST_API_TOKEN']);
const env={...process.env};for(const key of keys)env[key]=config[key]??'';
if(action==='start'){
 let built;try{built=JSON.parse(readFileSync('.next/vvn-deployment.json','utf8'));}catch{throw Error(`Ejecuta npm run build:${environment} antes de iniciar.`);}
 if(built.environment!==environment||built.projectRef!==config.VVN_EXPECTED_SUPABASE_PROJECT_REF)throw Error('El build corresponde a otro ambiente. Compila de nuevo para el ambiente solicitado.');
}
const args=action==='build'?['build','--webpack']:[action,'--hostname','127.0.0.1','--port',process.env.PORT||'3123',...(action==='dev'?['--webpack']:[])];
env.PORT=process.env.PORT||'3123';env.HOSTNAME='127.0.0.1';
const command=action==='start'?['.next/standalone/server.js']:['node_modules/next/dist/bin/next',...args];
const child=spawn(process.execPath,command,{env,stdio:'inherit'});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
const [code]=await once(child,'exit');
if(action==='build'&&code===0){
 await import('./clean-standalone-env.mjs');
 writeFileSync('.next/vvn-deployment.json',JSON.stringify({environment,projectRef:config.VVN_EXPECTED_SUPABASE_PROJECT_REF}));
}
process.exitCode=code??1;
