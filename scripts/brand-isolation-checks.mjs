import assert from 'node:assert/strict';

/** Ataques y controles positivos sobre el bundle real; backend sintético, sin Supabase remoto. */
export async function runBrandIsolationChecks({base,id,brandId,otherBrandId,tables,rpcCalls}) {
  let checks=0;
  const call=async(path,body,expected=200)=>{
    const response=await fetch(`${base}/api/v1${path}`,{
      headers:{'Content-Type':'application/json','X-Forwarded-For':'192.0.2.101',
        'X-Visitor-Id':id(95),'X-Brand-Id':otherBrandId},
      ...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)}),
    });
    const json=await response.json();
    assert.equal(response.status,expected,`${path}: ${JSON.stringify(json)}`);
    checks++;
    return json;
  };

  // La marca no cambia con headers ni query params. Incluir IDs/slugs duplicados.
  for(const path of ['/config','/fraccionamientos','/fraccionamientos/zona-prueba',
    `/plazas/${id(2)}`,`/parques/${id(3)}`,`/venues/${id(4)}`,
    '/venues/resolve?path=panaderia-prueba','/feed','/cupones','/blog','/blog/post-prueba']) {
    const result=await call(path+(path.includes('?')?'&':'?')+`brand_id=${otherBrandId}`);
    assert(!JSON.stringify(result).includes('OTHER-BRAND-PRIVATE'),`Filtración en ${path}`);
  }
  assert.equal((await call('/fraccionamientos/zona-prueba')).data.fraccionamiento.id,id(1));
  assert.equal((await call('/blog/post-prueba')).data.post.id,id(6));
  const list=(await call('/fraccionamientos')).data.fraccionamientos;
  assert.deepEqual(list.map(f=>f.id),[id(1)]);

  for(const path of [`/venues/${id(14)}`,`/venues/${id(5)}`,`/plazas/${id(12)}`,
    `/parques/${id(13)}`,`/venues/resolve?path=${id(14)}`,`/ratings?venueId=${id(14)}`]) {
    assert.equal((await call(path,undefined,404)).error,'not_found');
  }

  const before=JSON.stringify({tables,rpcCalls});
  for(const kind of ['view','whatsapp','website'])
    await call('/stats/venue',{venueId:id(14),kind},404);
  await call('/stats/vvn',{id:id(12),kind:'plaza'},404);
  await call('/stats/vvn',{id:id(13),kind:'parque'},404);
  await call('/stats/promotions',{ids:[id(17)],kind:'view'},404);
  await call('/stats/promotions',{ids:[id(7),id(17)],kind:'tap'},404);
  await call('/ratings',{venueId:id(14),stars:5},404);
  await call('/track',{event:'directions',entityType:'venue',entityId:id(14)},400);
  await call('/track',{event:'search',fraccionamientoId:id(11)},400);
  await call('/track',{event:'directions',entityType:'ocasion',entityId:id(14)},400);
  assert.equal(JSON.stringify({tables,rpcCalls}),before,'Una petición ajena cambió datos o llamó un RPC.');

  // La API sigue escribiendo en VVN y el payload no puede cambiar la marca.
  for(const kind of ['view','whatsapp','website'])
    await call('/stats/venue',{venueId:id(4),kind,brand_id:otherBrandId});
  await call('/stats/vvn',{id:id(2),kind:'plaza'});
  await call('/stats/vvn',{id:id(3),kind:'parque'});
  await call('/stats/promotions',{ids:[id(7)],kind:'tap'});
  await call('/track',{event:'app_open',brand_id:otherBrandId,brandId:otherBrandId});
  const last=tables.analytics_events.at(-1);
  assert.equal(last.brand_id,brandId);
  assert.equal(last.event_type,'app_open');
  await call('/track',{event:'directions',entityType:'venue',entityId:id(4)});
  await call('/ratings',{venueId:id(4),stars:5});
  await call('/ratings',{venueId:id(4),stars:4});
  const rating=(await call(`/ratings?venueId=${id(4)}`)).data;
  assert.deepEqual(rating,{sum:4,count:1,mine:4});
  const device=await call('/devices',{token:'synthetic-private-token',platform:'ios'},503);
  assert.equal(device.error,'unavailable');
  assert(!JSON.stringify(device).includes('synthetic-private-token'));
  assert.equal(tables.device_tokens.length,0);
  console.log(`\nAislamiento VVN: ${checks} peticiones verificadas; otra marca sin lecturas ni escrituras.`);
}
