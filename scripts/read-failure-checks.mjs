import assert from 'node:assert/strict';

// Fallas persistentes hasta retirarlas explícitamente: probar el caché real de
// Next, no una implementación simulada de unstable_cache.
export async function runReadFailureChecks({base,id,tables,rpcCalls,setFailure}) {
 let sequence=1000,requests=0;
 const own=table=>tables[table].find(row=>row.brand_id===tables.brands[0].id);
 function fresh() {
  const n=sequence;sequence+=10;
  const slug=`recuperacion-${n}`;
  const f={...own('fraccionamientos'),id:id(n),slug};
  const p={...own('plazas'),id:id(n+1),fraccionamiento_id:f.id,slug};
  const k={...own('parques'),id:id(n+2),fraccionamiento_id:f.id,slug};
  const v={...own('venues'),id:id(n+3),fraccionamiento_id:f.id,plaza_id:p.id,name:slug,type:'both'};
  const b={...own('blog_posts'),id:id(n+4),slug,body:`@venue:${slug} | Recuperación`};
  const promo={...own('promotions'),id:id(n+5),venue_id:v.id};
  for(const [table,row] of Object.entries({fraccionamientos:f,plazas:p,parques:k,venues:v,blog_posts:b,promotions:promo}))tables[table].push(row);
  return {f,p,k,v,b,promo,slug};
 }
 async function request(path,status,body) {
  requests++;
  const response=await fetch(`${base}/api/v1${path}`,{
   headers:{'Content-Type':'application/json','X-Forwarded-For':`192.0.2.${120+requests%100}`,'X-Visitor-Id':id(999)},
   ...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),
  });
  const json=await response.json();
  assert.equal(response.status,status,`${path}: ${JSON.stringify(json)}`);
  assert(!JSON.stringify(json).includes('PRIVATE_DATABASE_DETAIL'),path);
  if(status===500){
   assert.equal(json.error,'server_error',path);
   assert.equal(response.headers.get('cache-control'),'private, no-store',path);
   assert.equal(response.headers.get('etag'),null,path);
   assert.equal(json.data,undefined,'No publicar un resultado parcial');
  }
  return {response,json};
 }
 async function recover(table,pathFor,bodyFor) {
  const f=fresh(),path=pathFor(f),body=bodyFor?.(f);
  setFailure(req=>req.table===table);
  try{await request(path,500,body);}finally{setFailure(null);}
  const result=await request(path,200,body);
  assert.equal(result.json.ok,true,path);
 }
 for(const table of ['venues','menu_items','services','promotions','venue_photos','plazas','fraccionamientos'])
  await recover(table,f=>`/venues/${f.v.id}`);
 for(const table of ['fraccionamientos','plazas','parques','venues','vvn_announcements','promotions'])
  await recover(table,f=>`/fraccionamientos/${f.slug}`);
 for(const [table,path] of [
  ['plazas',f=>`/plazas/${f.p.id}`],['parques',f=>`/parques/${f.k.id}`],
  ['blog_posts',f=>`/blog/${f.slug}`],['promotions',()=>'/cupones'],
  ['venues',()=>'/feed'],['vvn_announcements',()=>'/feed'],
  ['venues',f=>`/venues/resolve?path=${f.v.id}`],
  ['venues',f=>`/venues/resolve?path=${f.slug}`],
  ['venues',f=>`/venues/resolve?path=negocio-${f.v.id.slice(0,8)}`],
 ])await recover(table,path);

 setFailure(req=>req.table==='fraccionamientos');
 try{
  const {response,json}=await request('/config',200);
  assert.equal(response.headers.get('x-data-degraded'),'1');
  assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal(response.headers.get('etag'),null);
  assert.equal(json.data.default_fraccionamiento_slug,null);
 }finally{setFailure(null);}
 const config=await request('/config',200);
 assert.equal(config.response.headers.get('x-data-degraded'),null);
 assert(config.response.headers.get('cache-control').startsWith('public,'));
 assert(config.json.data.default_fraccionamiento_slug);

 // No persistir ausencias en el caché interno de cinco minutos.
 for(const kind of ['venue','fraccionamiento','resolve']) {
  const f=fresh(), table=kind==='fraccionamiento'?'fraccionamientos':'venues';
  const row=kind==='fraccionamiento'?f.f:f.v;
  const path=kind==='venue'?`/venues/${row.id}`:kind==='resolve'?`/venues/resolve?path=${f.slug}`:`/fraccionamientos/${f.slug}`;
  tables[table].splice(tables[table].indexOf(row),1);
  const missing=await request(path,404);
  assert.equal(missing.response.headers.get('cache-control'),'public, s-maxage=10, stale-while-revalidate=10');
  tables[table].push(row);
  await request(path,200);
 }

 for(const [rpc,path,body] of [
  ['rpc/increment_venue_views','/stats/venue',f=>({venueId:f.v.id,kind:'view'})],
  ['rpc/increment_plaza_views','/stats/vvn',f=>({id:f.p.id,kind:'plaza'})],
  ['rpc/increment_promotion_views','/stats/promotions',f=>({ids:[f.promo.id],kind:'view'})],
 ]) {
  const f=fresh(),before=rpcCalls.length,events=tables.analytics_events.length;
  setFailure(req=>req.table===rpc);
  try{await request(path,500,body(f));}finally{setFailure(null);}
  assert.equal(rpcCalls.length,before,'No usar un contador alternativo tras fallar RPC');
  assert.equal(tables.analytics_events.length,events,'No contar éxito de un RPC fallido');
  await request(path,200,body(f));
  assert.equal(rpcCalls.length,before+1);
 }
 console.log(`\nErrores y recuperación: ${requests} peticiones; fallas 500 sin caché, ausencia 404 y recuperación inmediata verificadas.`);
}
