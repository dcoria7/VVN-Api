// Integración REAL, exclusivamente contra vvn-pruebas. Crea datos sintéticos.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';

const env=parseEnv(readFileSync(new URL('../.env.local',import.meta.url),'utf8'));
const TEST_URL='https://msfrkqfvdhyjnktwuhzd.supabase.co';
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL,TEST_URL,'Esta prueba solo admite vvn-pruebas.');
const runId=randomUUID().slice(0,8), slug=`api-test-${runId}`;
let checks=0;
function check(condition,message){assert(condition,message);checks++;}
function ok(result,label){check(!result.error,`${label}: código ${result.error?.code||result.error?.status||'desconocido'}`);return result.data;}
function denied(result,label){check(!!result.error,`${label}: la escritura debió ser rechazada`);}
const auth={persistSession:false,autoRefreshToken:false,detectSessionInUrl:false};
const actors=[];
for(const [name,email,password,brandId] of [
 ['VVN',env.BRAND_OPERATOR_EMAIL,env.BRAND_OPERATOR_PASSWORD,env.VVN_BRAND_ID],
 ['OTHER',env.TEST_OTHER_OPERATOR_EMAIL,env.TEST_OTHER_OPERATOR_PASSWORD,env.TEST_OTHER_BRAND_ID],
]){
 check(!!email&&!!password&&!!brandId,`Faltan credenciales de ${name}`);
 const db=createClient(TEST_URL,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY,{auth});
 const login=await db.auth.signInWithPassword({email,password});
 check(!login.error&&!!login.data.session,`Falló login de ${name}: ${login.error?.code||'sin sesión'}`);
 const brands=ok(await db.from('brands').select('id,slug'),`marcas ${name}`);
 check(brands.length===1&&brands[0].id===brandId,`${name} debe ver una sola marca`);
 const operators=await db.from('brand_operators').select('user_id');
 check(!!operators.error,'Las asignaciones administrativas no deben ser legibles por el operador');
 actors.push({name,brandId,userId:login.data.user.id,db,fixtures:{}});
}

for(const actor of actors){
 const {db,fixtures:f,name}=actor;
 // Sin brand_id en el payload: el trigger debe derivarlo del JWT del operador.
 f.fracc=ok(await db.from('fraccionamientos').insert({name:`Fraccionamiento sintético ${name}`,slug}).select('id,brand_id').single(),`crear fraccionamiento ${name}`);
 check(f.fracc.brand_id===actor.brandId,'El trigger debe asignar la marca del operador');
 f.plaza=ok(await db.from('plazas').insert({name:`Plaza sintética ${name}`,slug,fraccionamiento_id:f.fracc.id}).select('id,brand_id').single(),`crear plaza ${name}`);
 f.parque=ok(await db.from('parques').insert({name:`Parque sintético ${name}`,slug,fraccionamiento_id:f.fracc.id}).select('id,brand_id').single(),`crear parque ${name}`);
 const now=new Date().toISOString();
 f.venue=ok(await db.from('venues').insert({
  owner_id:actor.userId,name:`Negocio sintético ${name} ${runId}`,type:'both',description:`Datos sintéticos ${name}`,
  lat:20.7,lng:-103.4,location_reference:'Solo para pruebas de integración',is_active:true,
  fraccionamiento_id:f.fracc.id,plaza_id:f.plaza.id,is_premium:true,
  daily_text:`Actualización sintética ${name}`,daily_updated_at:now,
 }).select('id,brand_id').single(),`crear negocio ${name}`);
 f.menu=ok(await db.from('menu_items').insert({venue_id:f.venue.id,name:'Producto sintético',price:25}).select('id,brand_id').single(),`crear menú ${name}`);
 f.service=ok(await db.from('services').insert({venue_id:f.venue.id,name:'Servicio sintético',price:50}).select('id,brand_id').single(),`crear servicio ${name}`);
 f.promo=ok(await db.from('promotions').insert({venue_id:f.venue.id,kind:'coupon',title:`Cupón sintético ${name}`,code:'SOLO-PRUEBAS',is_active:true}).select('id,brand_id').single(),`crear promoción ${name}`);
 f.photo=ok(await db.from('venue_photos').insert({venue_id:f.venue.id,url:'https://example.invalid/synthetic.jpg'}).select('id,brand_id').single(),`crear foto ${name}`);
 f.blog=ok(await db.from('blog_posts').insert({title:`Artículo sintético ${name}`,slug,body:`Contenido de prueba ${name}`,category:'guia',published_at:now,is_active:true}).select('id,brand_id').single(),`crear blog ${name}`);
 f.announcement=ok(await db.from('vvn_announcements').insert({title:`Aviso sintético ${name}`,body:`Aviso de prueba ${name}`}).select('id,brand_id').single(),`crear aviso ${name}`);
 check(Object.values(f).every(row=>row.brand_id===actor.brandId),'Todos los hijos deben heredar la marca correcta');
}

for(let i=0;i<actors.length;i++){
 const a=actors[i],b=actors[1-i],db=a.db,f=a.fixtures,g=b.fixtures;
 for(const table of ['fraccionamientos','plazas','parques','venues','menu_items','services','promotions','venue_photos','blog_posts','vvn_announcements']){
  const rows=ok(await db.from(table).select('id,brand_id'),`lectura sin filtro ${a.name}/${table}`);
  check(rows.length>0&&rows.every(row=>row.brand_id===a.brandId),`RLS filtró incorrectamente ${table}`);
 }
 for(const table of ['fraccionamientos','blog_posts']){
  const row=ok(await db.from(table).select('brand_id').eq('slug',slug).single(),`slug repetido ${table}`);
  check(row.brand_id===a.brandId,'El mismo slug debe resolver únicamente dentro de la marca');
 }
 const hidden=ok(await db.from('venues').select('id').eq('id',g.venue.id),'UUID ajeno');
 check(hidden.length===0,'Un UUID ajeno debe quedar oculto');
 const update=ok(await db.from('venues').update({name:'NO DEBE CAMBIAR'}).eq('id',g.venue.id).select('id'),'update ajeno');
 check(update.length===0,'El update ajeno debe afectar cero filas');
 const deletion=ok(await db.from('venues').delete().eq('id',g.venue.id).select('id'),'delete ajeno');
 check(deletion.length===0,'El delete ajeno debe afectar cero filas');
 check(!!ok(await b.db.from('venues').select('id').eq('id',g.venue.id).single(),'negocio ajeno conservado'),'El registro de la otra marca debe seguir existiendo');
 denied(await db.from('venues').update({brand_id:b.brandId}).eq('id',f.venue.id),'cambio de marca');
 denied(await db.from('menu_items').insert({venue_id:g.venue.id,name:'Relación cruzada'}),'hijo de otra marca');
 denied(await db.from('menu_items').insert({venue_id:f.venue.id,name:'Marca falsificada',brand_id:b.brandId}),'brand_id falsificado');
 denied(await db.from('venues').update({plaza_id:g.plaza.id}).eq('id',f.venue.id),'plaza de otra marca');
 denied(await db.from('analytics_events').insert({event_type:'directions',entity_type:'venue',entity_id:g.venue.id}),'analítica cruzada');
 denied(await db.from('brand_operators').insert({user_id:a.userId,brand_id:b.brandId}),'autoasignación de marca');

 // RPCs: el ID no puede saltarse RLS aunque se conozca el UUID ajeno.
 for(const [table,id,foreignId,rpc,arg,column] of [
  ['venues',f.venue.id,g.venue.id,'increment_venue_views','venue_id','views'],
  ['venues',f.venue.id,g.venue.id,'increment_whatsapp_taps','venue_id','whatsapp_taps'],
  ['venues',f.venue.id,g.venue.id,'increment_website_taps','venue_id','website_taps'],
  ['plazas',f.plaza.id,g.plaza.id,'increment_plaza_views','plaza_id','views'],
  ['parques',f.parque.id,g.parque.id,'increment_parque_views','parque_id','views'],
  ['promotions',f.promo.id,g.promo.id,'increment_promotion_views','p_id','views'],
  ['promotions',f.promo.id,g.promo.id,'increment_promotion_taps','p_id','taps'],
 ]){
  const before=ok(await db.from(table).select(column).eq('id',id).single(),'contador propio antes');
  ok(await db.rpc(rpc,{[arg]:id}),`RPC propio ${rpc}`);
  const after=ok(await db.from(table).select(column).eq('id',id).single(),'contador propio después');
  check(after[column]===before[column]+1,`El RPC ${rpc} debe incrementar exactamente una vez`);
  const foreignBefore=ok(await b.db.from(table).select(column).eq('id',foreignId).single(),'contador ajeno antes');
  const attempt=await db.rpc(rpc,{[arg]:foreignId});
  check(!attempt.error||['42501','23503','23514'].includes(attempt.error.code),'Respuesta inesperada al RPC ajeno');
  const foreignAfter=ok(await b.db.from(table).select(column).eq('id',foreignId).single(),'contador ajeno después');
  check(foreignAfter[column]===foreignBefore[column],`El RPC ${rpc} modificó otra marca`);
 }

 const visitor=`synthetic-${runId}-${a.name}`, ipKey=`synthetic-ip-${runId}`;
 ok(await db.from('venue_ratings').upsert({venue_id:f.venue.id,visitor_key:visitor,ip_day_key:ipKey,stars:5},{onConflict:'venue_id,visitor_key'}),'crear voto propio');
 let rating=ok(await db.from('venues').select('rating_sum,rating_count').eq('id',f.venue.id).single(),'trigger de voto nuevo');
 check(rating.rating_sum===5&&rating.rating_count===1,'El trigger debe sumar el voto nuevo');
 ok(await db.from('venue_ratings').upsert({venue_id:f.venue.id,visitor_key:visitor,ip_day_key:ipKey,stars:4},{onConflict:'venue_id,visitor_key'}),'corregir voto propio');
 rating=ok(await db.from('venues').select('rating_sum,rating_count').eq('id',f.venue.id).single(),'trigger de corrección');
 check(rating.rating_sum===4&&rating.rating_count===1,'Corregir un voto no debe inflar el conteo');
 denied(await db.from('venue_ratings').insert({venue_id:g.venue.id,visitor_key:visitor,ip_day_key:ipKey,stars:1}),'voto cruzado');
 ok(await db.from('analytics_events').insert({event_type:'app_open'}),'evento sin entidad');
 const events=ok(await db.from('analytics_events').select('brand_id'),'analítica propia');
 check(events.length>0&&events.every(row=>row.brand_id===a.brandId),'Los eventos deben quedar asignados al operador');
 console.log(`${a.name}: RLS, relaciones, 7 RPCs y trigger de calificaciones verificados.`);
}

const output=new URL('../.test-results/',import.meta.url);mkdirSync(output,{recursive:true,mode:0o700});
writeFileSync(new URL('supabase-fixtures.json',output),JSON.stringify({projectUrl:TEST_URL,runId,slug,actors:actors.map(({name,brandId,fixtures})=>({name,brandId,fixtures}))},null,2),{mode:0o600});
writeFileSync(new URL('supabase-verification.json',output),JSON.stringify({projectUrl:TEST_URL,verifiedAt:new Date().toISOString(),checks,runId,syntheticDataOnly:true},null,2),{mode:0o600});
console.log(`${checks} comprobaciones reales correctas. Fixtures sintéticos conservados en vvn-pruebas.`);
