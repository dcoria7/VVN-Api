// Rutas HTTP reales + Supabase de pruebas. Necesita build y verify:test-db previos.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createClient} from '@supabase/supabase-js';

const conf=parseEnv(readFileSync('.env.local','utf8'));
assert.equal(conf.VVN_ENVIRONMENT,'staging');
const fixtures=JSON.parse(readFileSync('.test-results/supabase-fixtures.json','utf8'));
const TEST_URL='https://msfrkqfvdhyjnktwuhzd.supabase.co';
assert.equal(conf.NEXT_PUBLIC_SUPABASE_URL,TEST_URL,'Solo se permite vvn-pruebas');
assert.equal(fixtures.projectUrl,TEST_URL);
assert(existsSync('.next/standalone/server.js'),'Primero ejecuta npm run build.');
const own=fixtures.actors.find(a=>a.name==='VVN'),other=fixtures.actors.find(a=>a.name==='OTHER');
assert.equal(own.brandId,conf.VVN_BRAND_ID);
assert.equal(other.brandId,conf.TEST_OTHER_BRAND_ID);
const f=own.fixtures,g=other.fixtures;
let checks=0,api,logs='',base;
function check(condition,message){assert(condition,message);checks++;}
function ok(result,label){check(!result.error,`${label}: código ${result.error?.code||'desconocido'}`);return result.data;}
function cleanError(error){
 let text=String(error);
 for(const secret of [conf.BRAND_OPERATOR_PASSWORD,conf.TEST_OTHER_OPERATOR_PASSWORD,conf.RATING_SALT])
  if(secret)text=text.split(secret).join('[REDACTADO]');
 return text;
}
async function login(email,password){
 const db=createClient(TEST_URL,conf.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const result=await db.auth.signInWithPassword({email,password});
 check(!result.error&&!!result.data.session,'No se pudo autenticar el operador de pruebas');return db;
}
const db=await login(conf.BRAND_OPERATOR_EMAIL,conf.BRAND_OPERATOR_PASSWORD);
const foreignDb=await login(conf.TEST_OTHER_OPERATOR_EMAIL,conf.TEST_OTHER_OPERATOR_PASSWORD);
const visitorId=randomUUID();
async function request(path,body,status=200,extraHeaders={}){
 const response=await fetch(`${base}/api/v1${path}`,{
  headers:{'Content-Type':'application/json','X-Visitor-Id':visitorId,'X-Forwarded-For':'192.0.2.110','X-Brand-Id':other.brandId,...extraHeaders},
  ...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),
 });
 check(response.headers.get('x-vvn-environment')==='staging','La API debe identificarse como staging');
 check(response.status===status,`${path}: esperado ${status}, recibido ${response.status}`);
 if(status===304)return {response};
 const json=await response.json();
 check(json.ok===(status===200),`Envoltura incorrecta en ${path}`);
 return {response,json};
}
async function counter(client,table,id,column){return ok(await client.from(table).select(column).eq('id',id).single(),'lectura de contador')[column];}

try{
 const reservation=createServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
 const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));base=`http://127.0.0.1:${port}`;
 const childEnv={PATH:process.env.PATH,NODE_ENV:'production',PORT:String(port),HOSTNAME:'127.0.0.1',NEXT_TELEMETRY_DISABLED:'1',SENTRY_DSN:'',UPSTASH_REDIS_REST_URL:'',UPSTASH_REDIS_REST_TOKEN:''};
 for(const key of ['VVN_ENVIRONMENT','VVN_EXPECTED_SUPABASE_PROJECT_REF','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY','VVN_BRAND_ID','BRAND_OPERATOR_EMAIL','BRAND_OPERATOR_PASSWORD','RATING_SALT','NEXT_PUBLIC_VVN_SITE_URL'])childEnv[key]=conf[key];
 api=spawn(process.execPath,['--import',new URL('./test-supabase-network-only.mjs',import.meta.url).href,'.next/standalone/server.js'],{env:childEnv,stdio:['ignore','pipe','pipe']});
 api.stdout.on('data',chunk=>logs+=chunk);api.stderr.on('data',chunk=>logs+=chunk);
 let ready=false;
 for(let i=0;i<100;i++){
  try{const r=await fetch(base);if(r.ok){ready=true;break;}}catch{}
  if(api.exitCode!==null)throw Error('El servidor de pruebas no pudo iniciar');
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 check(ready,'La API no quedó disponible');

 const list=(await request('/fraccionamientos')).json.data.fraccionamientos;
 check(list.some(row=>row.id===f.fracc.id)&&!list.some(row=>row.id===g.fracc.id),'El directorio mezcla marcas');
 for(const path of ['/config',`/fraccionamientos/${fixtures.slug}`,`/plazas/${f.plaza.id}`,`/parques/${f.parque.id}`,`/venues/${f.venue.id}`,
  `/venues/resolve?path=${f.venue.id}`,'/feed','/cupones','/blog',`/blog/${fixtures.slug}`]){
  const result=await request(path+(path.includes('?')?'&':'?')+`brand_id=${other.brandId}`);
  const text=JSON.stringify(result.json);
  for(const row of Object.values(g))check(!text.includes(row.id),`Un ID de otra marca salió en ${path}`);
 }
 const fracc=(await request(`/fraccionamientos/${fixtures.slug}`)).json.data;
 check(fracc.fraccionamiento.id===f.fracc.id,'El slug repetido resolvió otra marca');
 const post=(await request(`/blog/${fixtures.slug}`)).json.data.post;
 check(post.id===f.blog.id,'El slug repetido del blog resolvió otra marca');
 const short=(await request(`/venues/resolve?path=negocio-${f.venue.id.slice(0,8)}`)).json.data;
 check(short.id===f.venue.id,'El prefijo UUID debe resolverse con un rango válido en Postgres');
 await request(`/venues/resolve?path=negocio-${g.venue.id.slice(0,8)}`,undefined,404);
 const detail=await request(`/venues/${f.venue.id}`);
 for(const key of ['owner_id','brand_id','telegram_chat_id','whatsapp_wa_id','paid_until'])check(!(key in detail.json.data.venue),'Campo privado en DTO: '+key);
 check(!('bot_phone' in detail.json.data.venue.contact),'El DTO publica el teléfono del bot');
 check(detail.json.data.menu_items.length===1&&detail.json.data.services.length===1&&detail.json.data.photos.length===1&&detail.json.data.promotions.length===1,'La ficha debe traer contenido sintético completo');
 check(!!detail.response.headers.get('etag'),'La ficha debe emitir ETag');
 await request(`/venues/${f.venue.id}`,undefined,304,{'If-None-Match':detail.response.headers.get('etag')});
 for(const path of [`/venues/${g.venue.id}`,`/plazas/${g.plaza.id}`,`/parques/${g.parque.id}`,`/venues/resolve?path=${g.venue.id}`,`/ratings?venueId=${g.venue.id}`])await request(path,undefined,404);

 const snapshot=()=>Promise.all([
  foreignDb.from('venues').select('views,whatsapp_taps,website_taps,rating_sum,rating_count').eq('id',g.venue.id).single(),
  foreignDb.from('promotions').select('views,taps').eq('id',g.promo.id).single(),
  foreignDb.from('plazas').select('views').eq('id',g.plaza.id).single(),
  foreignDb.from('parques').select('views').eq('id',g.parque.id).single(),
 ]).then(results=>results.map(r=>ok(r,'snapshot ajeno')));
 const before=JSON.stringify(await snapshot());
 for(const kind of ['view','whatsapp','website'])await request('/stats/venue',{venueId:g.venue.id,kind},404);
 await request('/stats/vvn',{id:g.plaza.id,kind:'plaza'},404);
 await request('/stats/vvn',{id:g.parque.id,kind:'parque'},404);
 await request('/stats/promotions',{ids:[g.promo.id],kind:'view'},404);
 const ownPromoBefore=await counter(db,'promotions',f.promo.id,'taps');
 await request('/stats/promotions',{ids:[f.promo.id,g.promo.id],kind:'tap'},404);
 check(await counter(db,'promotions',f.promo.id,'taps')===ownPromoBefore,'Un lote mixto no debe escribir parcialmente');
 await request('/ratings',{venueId:g.venue.id,stars:1},404);
 await request('/track',{event:'directions',entityType:'venue',entityId:g.venue.id},400);
 await request('/track',{event:'search',fraccionamientoId:g.fracc.id},400);
 check(JSON.stringify(await snapshot())===before,'Un request de la API modificó datos de otra marca');

 for(const [path,body,table,id,column] of [
  ['/stats/venue',{venueId:f.venue.id,kind:'view'},'venues',f.venue.id,'views'],
  ['/stats/venue',{venueId:f.venue.id,kind:'whatsapp'},'venues',f.venue.id,'whatsapp_taps'],
  ['/stats/venue',{venueId:f.venue.id,kind:'website'},'venues',f.venue.id,'website_taps'],
  ['/stats/vvn',{id:f.plaza.id,kind:'plaza'},'plazas',f.plaza.id,'views'],
  ['/stats/vvn',{id:f.parque.id,kind:'parque'},'parques',f.parque.id,'views'],
  ['/stats/promotions',{ids:[f.promo.id],kind:'view'},'promotions',f.promo.id,'views'],
  ['/stats/promotions',{ids:[f.promo.id],kind:'tap'},'promotions',f.promo.id,'taps'],
 ]){
  const start=await counter(db,table,id,column);await request(path,{...body,brand_id:other.brandId});
  check(await counter(db,table,id,column)===start+1,`El contador no avanzó exactamente una vez: ${column}`);
 }
 const firstRating=await request(`/ratings?venueId=${f.venue.id}`);
 check(firstRating.response.headers.get('cache-control')==='private, no-store','La calificación no debe cachearse públicamente');
 check(firstRating.json.data.mine===null,'Una instalación nueva no debe tener voto propio');
 const original=firstRating.json.data;
 const created=(await request('/ratings',{venueId:f.venue.id,stars:5})).json.data;
 check(created.sum===original.sum+5&&created.count===original.count+1&&created.mine===5,'El voto HTTP no actualizó los contadores');
 const updated=(await request('/ratings',{venueId:f.venue.id,stars:3})).json.data;
 check(updated.sum===original.sum+3&&updated.count===original.count+1&&updated.mine===3,'Corregir un voto HTTP alteró el conteo');
 check((await request(`/ratings?venueId=${f.venue.id}`)).json.data.mine===3,'El visitante no recuperó su voto');
 await request('/track',{event:'app_open',platform:'ios',brand_id:other.brandId});
 const events=ok(await db.from('analytics_events').select('brand_id,event_type').eq('brand_id',own.brandId),'analítica HTTP');
 check(events.every(row=>row.brand_id===own.brandId),'La analítica HTTP cambió de marca');
 await request('/devices',{token:'synthetic-integration-token',platform:'ios'},503);
 check(!logs.includes('read-modify-write'),'Las pruebas activaron el fallback no atómico');
 writeFileSync('.test-results/api-verification.json',JSON.stringify({verifiedAt:new Date().toISOString(),projectUrl:TEST_URL,checks,runId:fixtures.runId},null,2),{mode:0o600});
 console.log(`${checks} comprobaciones HTTP y de persistencia correctas contra vvn-pruebas.`);
}catch(error){console.error(cleanError(error));process.exitCode=1;}
finally{
 if(api&&api.exitCode===null){api.kill('SIGTERM');await once(api,'exit');}
}
