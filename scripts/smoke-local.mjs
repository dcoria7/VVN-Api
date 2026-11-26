// Prueba HTTP del build con un PostgREST falso en memoria. Sin .env ni red externa.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { runBrandIsolationChecks } from './brand-isolation-checks.mjs';
import { runReadFailureChecks } from './read-failure-checks.mjs';
assert(existsSync('.next/standalone/server.js'), 'Primero ejecuta el build de prueba del README.');
assert(!existsSync('.next/standalone/.env.local') && !existsSync('.next/standalone/.env'), 'Reconstruye sin archivos .env.');
const origin='http://127.0.0.1:54321', now=new Date().toISOString();
const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
const brandId=id(90), otherBrandId=id(91), operatorToken='synthetic-operator-token';
const v={brand_id:brandId,id:id(4),name:'Panaderia Prueba',description:'Sintético',type:'food',status:'open',status_updated_at:now,is_active:true,fraccionamiento_id:id(1),plaza_id:id(2),is_premium:true,is_featured:true,location_reference:'Prueba',lat:20.7,lng:-103.4,phone:'0000000000',logo_url:null,cover_url:null,instagram:null,address:null,owner_id:'PRIVATE-OWNER',bot_phone:'PRIVATE-BOT',telegram_chat_id:'PRIVATE-CHAT',paid_until:'2099-01-01',created_at:now,updated_at:now,daily_text:'Prueba local',daily_updated_at:now,views:2,rating_sum:0,rating_count:0};
const tables={
 fraccionamientos:[{id:id(1),slug:'zona-prueba',name:'Zona Prueba',created_at:now}],
 plazas:[{id:id(2),fraccionamiento_id:id(1),slug:'plaza-prueba',name:'Plaza Prueba',created_at:now}],
 parques:[{id:id(3),fraccionamiento_id:id(1),slug:'parque-prueba',name:'Parque Prueba',created_at:now}],
 venues:[v,{...v,id:id(5),name:'ClickLocal General',fraccionamiento_id:null,plaza_id:null}],
 blog_posts:[{id:id(6),slug:'post-prueba',title:'Post Prueba',body:'@venue:panaderia-prueba | Prueba local',category:'guia',is_active:true,published_at:'2020-01-01T00:00:00Z',created_at:now,updated_at:now}],
 promotions:[{id:id(7),venue_id:v.id,kind:'coupon',title:'Oferta Prueba',description:'Prueba',discount_label:'10%',code:'LOCAL',image_url:null,terms:null,starts_at:null,ends_at:null,is_active:true,created_at:now,updated_at:now}],
 vvn_announcements:[{id:id(8),title:'Aviso',body:'Prueba',is_active:true,created_at:now,updated_at:now}],
 menu_items:[],services:[],venue_photos:[],venue_ratings:[],device_tokens:[],analytics_events:[],
};
// La otra marca va primero y reutiliza slugs/nombres; una consulta sin ámbito
// devolvería datos ajenos o múltiples filas en maybeSingle.
for (const rows of Object.values(tables)) for (const row of rows) row.brand_id=brandId;
tables.venues[1].brand_id=otherBrandId;
const foreignVenue={...v,id:id(14),brand_id:otherBrandId,fraccionamiento_id:id(11),plaza_id:id(12),description:'OTHER-BRAND-PRIVATE'};
for (const [table, row] of Object.entries({
 fraccionamientos:{...tables.fraccionamientos[0],id:id(11),name:'OTHER-BRAND-PRIVATE'},
 plazas:{...tables.plazas[0],id:id(12),fraccionamiento_id:id(11),name:'OTHER-BRAND-PRIVATE'},
 parques:{...tables.parques[0],id:id(13),fraccionamiento_id:id(11),name:'OTHER-BRAND-PRIVATE'},
 venues:foreignVenue,
 blog_posts:{...tables.blog_posts[0],id:id(16),body:'OTHER-BRAND-PRIVATE'},
 promotions:{...tables.promotions[0],id:id(17),venue_id:id(14),description:'OTHER-BRAND-PRIVATE'},
 vvn_announcements:{...tables.vvn_announcements[0],id:id(18),body:'OTHER-BRAND-PRIVATE'},
 venue_ratings:{id:id(19),venue_id:id(14),visitor_key:'foreign',stars:1},
})) tables[table].unshift({...row,brand_id:otherBrandId});
// Simulación de la tabla de identidad y de la autenticación del operador.
tables.brands=[{id:brandId,slug:'vive-valle-norte',is_active:true},{id:otherBrandId,slug:'otra-marca',is_active:true}];
let reads=0,writes=0,api,logins=0,failure=null;
const rpcCalls=[];
const stub=createServer(async(req,res)=>{
 const json=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
 try{
  const u=new URL(req.url,origin);
  assert.equal(req.headers.apikey,'local-test-key');
  if(u.pathname==='/auth/v1/token') {
   let raw='';for await(const c of req)raw+=c;
   assert.deepEqual(JSON.parse(raw),{email:'operator@example.invalid',password:'synthetic-password',gotrue_meta_security:{}});
   logins++;
   return json({access_token:operatorToken,refresh_token:'synthetic-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:id(92)}});
  }
  assert(u.pathname.startsWith('/rest/v1/'));
  assert.equal(req.headers.authorization,`Bearer ${operatorToken}`);
  const table=u.pathname.slice('/rest/v1/'.length);
  if(failure?.({table,method:req.method,url:u}))return json({code:'XX000',message:'PRIVATE_DATABASE_DETAIL'},500);
  if(req.method==='POST'){
   writes++;let raw='';for await(const c of req)raw+=c;
   if(table.startsWith('rpc/')) {
    const args=JSON.parse(raw), n=table.slice(4);
    const [entity,targetTable,column]=n.includes('promotion')?[args.p_id,'promotions',n.endsWith('views')?'views':'taps']:n.includes('plaza')?[args.plaza_id,'plazas','views']:n.includes('parque')?[args.parque_id,'parques','views']:[args.venue_id,'venues',n.includes('whatsapp')?'whatsapp_taps':n.includes('website')?'website_taps':'views'];
    const row=tables[targetTable].find(r=>r.id===entity&&r.brand_id===brandId);
    assert(row,'El RPC nunca debe recibir un ID ajeno o inexistente.');
    rpcCalls.push({name:n,id:entity});row[column]=(row[column]??0)+1;return json(null);
   }
   assert(Object.hasOwn(tables,table));assert.notEqual(table,'device_tokens');
   const data=JSON.parse(raw), incoming=Array.isArray(data)?data:[data];
   for(const row of incoming) {
    assert.equal(row.brand_id,brandId,'Toda escritura debe llevar la marca del servidor.');
    for(const [field,parent] of [['venue_id','venues'],['fraccionamiento_id','fraccionamientos']])
     if(row[field])assert(tables[parent].some(r=>r.id===row[field]&&r.brand_id===brandId));
    if(row.entity_id)assert(Object.values(tables).flat().some(r=>r.id===row.entity_id&&r.brand_id===brandId));
   }
   for(const row of incoming) {
    const existing=table==='venue_ratings'?tables[table].find(r=>r.venue_id===row.venue_id&&r.visitor_key===row.visitor_key):null;
    if(existing)Object.assign(existing,row);else tables[table].push(row);
   }
   if(table==='venue_ratings')for(const row of incoming){
    const venue=tables.venues.find(v=>v.id===row.venue_id);
    const ratings=tables.venue_ratings.filter(r=>r.venue_id===row.venue_id);
    venue.rating_count=ratings.length;venue.rating_sum=ratings.reduce((sum,r)=>sum+r.stars,0);
   }
   return json(null,201);
  }
  assert(req.method==='GET'||req.method==='HEAD');reads++;assert(Object.hasOwn(tables,table));let rows=tables[table].slice();
  // No simular RLS en lecturas: el test exige que la API mande el filtro explícito.
  if(table!=='brands')assert.equal(u.searchParams.get('brand_id'),`eq.${brandId}`);
  for(const [field,filter] of u.searchParams){
   if(['select','order','limit','offset','or'].includes(field))continue;
   rows=rows.filter(row=>{
    const a=row[field];
    if(filter.startsWith('eq.'))return String(a)===filter.slice(3);
    if(filter==='not.is.null')return a!=null;
    if(filter==='is.null')return a==null;
    if(filter.startsWith('in.('))return filter.slice(4,-1).split(',').includes(String(a));
    if(filter.startsWith('lte.'))return a<=filter.slice(4);
    if(filter.startsWith('gte.'))return a>=filter.slice(4);
    if(filter.startsWith('ilike.'))return String(a).startsWith(filter.slice(6).replace(/%$/,''));
    throw Error(`Filtro no implementado: ${filter}`);
   });
  }
  const count=rows.length;if(u.searchParams.has('limit'))rows=rows.slice(0,Number(u.searchParams.get('limit')));
  if(u.searchParams.get('select')?.includes('venue:venues!inner'))rows=rows.map(r=>({...r,venue:tables.venues.find(x=>x.id===r.venue_id)}));
  if(req.method==='HEAD'){res.writeHead(200,{'Content-Range':`0-0/${count}`});return res.end();}
  if(req.headers.accept?.includes('vnd.pgrst.object')){if(rows.length!==1)return json({code:'PGRST116',message:'No single row'},406);return json(rows[0]);}
  return json(rows);
 }catch(e){json({message:String(e)},500);}
});
try{
 await new Promise((ok,no)=>{stub.once('error',no);stub.listen(54321,'127.0.0.1',ok);});
 const reservation=createServer();await new Promise(ok=>reservation.listen(0,'127.0.0.1',ok));const port=reservation.address().port;await new Promise(ok=>reservation.close(ok));
 const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NODE_ENV:'production',VVN_ENVIRONMENT:'staging',HOSTNAME:'127.0.0.1',PORT:String(port),NEXT_PUBLIC_SUPABASE_URL:origin,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY:'local-test-key',VVN_BRAND_ID:brandId,BRAND_OPERATOR_EMAIL:'operator@example.invalid',BRAND_OPERATOR_PASSWORD:'synthetic-password',RATING_SALT:'local-test-salt',NEXT_TELEMETRY_DISABLED:'1'};
 let logs='';api=spawn(process.execPath,['--import',new URL('./local-network-only.mjs',import.meta.url).href,'.next/standalone/server.js'],{env,stdio:['ignore','pipe','pipe']});api.stdout.on('data',x=>logs+=x);api.stderr.on('data',x=>logs+=x);
 const base=`http://127.0.0.1:${port}`;let ready=false;
 for(let i=0;i<100;i++){
  try{const r=await fetch(base);if(r.ok){assert.equal((await r.json()).service,'vvn-api');ready=true;break;}}catch{}
  if(api.exitCode!==null)throw Error(logs);await new Promise(ok=>setTimeout(ok,100));
 }
 assert(ready,logs);const first=await fetch(base+'/api/v1/fraccionamientos');assert.equal(first.status,200);assert((await first.text()).includes('zona-prueba'));assert(reads>0,'El build no apunta al stub local.');
 const contract=spawn(process.execPath,['--import','tsx','scripts/check-v1-contract.ts',base,'--writes'],{env,stdio:'inherit'});const [code]=await once(contract,'exit');assert.equal(code,0,'Falló el contrato');
 for(const p of ['/admin','/vvn','/api/telegram/webhook','/api/whatsapp/webhook'])assert.equal((await fetch(base+p)).status,404,p);
 assert.deepEqual(JSON.parse(readFileSync('.next/routes-manifest.json','utf8')).rewrites,{beforeFiles:[],afterFiles:[],fallback:[]});
 await runBrandIsolationChecks({base,id,brandId,otherBrandId,tables,rpcCalls});
 await runReadFailureChecks({base,id,tables,rpcCalls,setFailure:fn=>{failure=fn;}});
 assert.equal(tables.device_tokens.length,0);assert(tables.analytics_events.some(r=>r.brand_id===brandId));assert.equal(logins,1);
 console.log(`\nSmoke aislado OK: ${reads} lecturas y ${writes} escrituras solo en memoria local. Sin rutas web ni rewrites externos.`);
}finally{
 if(api&&api.exitCode===null){api.kill('SIGTERM');await once(api,'exit');}
 await new Promise(ok=>stub.close(ok));
}
