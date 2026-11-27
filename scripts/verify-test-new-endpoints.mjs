// HTTP real + Auth/PostgREST/Storage, exclusivamente contra vvn-pruebas.
// Crea sus propios fixtures y los elimina al terminar. Nunca usa service role.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const conf = parseEnv(readFileSync('.env.staging.local', 'utf8'));
const TEST_URL = 'https://msfrkqfvdhyjnktwuhzd.supabase.co';
assert.equal(conf.VVN_ENVIRONMENT, 'staging');
assert.equal(conf.NEXT_PUBLIC_SUPABASE_URL, TEST_URL, 'Solo se permite vvn-pruebas');
assert.equal(conf.VVN_EXPECTED_SUPABASE_PROJECT_REF, 'msfrkqfvdhyjnktwuhzd');
const built = JSON.parse(readFileSync('.next/vvn-deployment.json', 'utf8'));
assert.equal(built.environment, 'staging', 'Ejecuta primero build:staging');
assert.equal(built.projectRef, conf.VVN_EXPECTED_SUPABASE_PROJECT_REF);
// La segunda cuenta solo existe en la configuración privada de las pruebas.
const otherConf = parseEnv(readFileSync('.env.local', 'utf8'));
assert.equal(otherConf.NEXT_PUBLIC_SUPABASE_URL, TEST_URL);
let checks = 0, api, base, requestNumber = 0;
const actors = [], objects = [], eventIds = [];
const secret = () => randomBytes(32).toString('hex');
const hash = value => createHash('sha256').update(value).digest('hex');
const run = randomUUID().slice(0, 8);
function check(value, label) { assert(value, label); checks++; }
function ok(result, label) { check(!result.error, `${label}: ${result.error?.code || result.error?.status || 'error'}`); return result.data; }
async function rpc(actor, op, args) {
  return ok(await actor.db.rpc('vvn_owner_api', { p_brand: actor.brand, p_op: op, p_args: args }), `RPC ${op}`);
}
async function request(path, { body, status = 200, headers = {}, auth, bytes, type } = {}) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method: body !== undefined || bytes !== undefined ? 'POST' : 'GET',
    headers: {
      'Content-Type': type ?? 'application/json',
      'X-Forwarded-For': `192.0.2.${++requestNumber}`,
      ...(auth ? { Authorization: `Bearer ${auth.session}`, 'X-Vvn-Device': auth.device } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : bytes !== undefined ? { body: bytes } : {}),
  });
  check(response.headers.get('x-vvn-environment') === 'staging', `${path}: ambiente`);
  check(response.status === status, `${path}: esperado ${status}, recibido ${response.status}`);
  if (status === 304) return { response };
  const json = await response.json();
  check(json.ok === (status === 200), `${path}: envoltura`);
  if (path.startsWith('/owner') || status >= 400) {
    check(response.headers.get('cache-control') === 'private, no-store', `${path}: privacidad de caché`);
    check(!response.headers.has('etag'), `${path}: sin ETag privado`);
  }
  return { response, json, data: json.data };
}
async function read(auth) { return (await request('/owner', { auth })).data; }
async function save(auth, section, values, extra = {}, status = 200) {
  const { revision } = await read(auth);
  return request('/owner', { auth, body: { operation: 'save', section, values, revision, ...extra }, status });
}
async function invite(actor, venue) {
  const token = secret();
  const result = await rpc(actor, 'admin_invite', { venue_id: venue.id, invitation_hash: hash(token) });
  check(!!result.expires_at, 'Invitación con vencimiento');
  return `vvn-owner:staging:${token}`;
}
async function fixture(name, email, password, brand) {
  const db = createClient(TEST_URL, conf.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const login = ok(await db.auth.signInWithPassword({ email, password }), `login ${name}`);
  const actor = { db, brand, venues: [], fracc: null };
  actors.push(actor);
  const brands = ok(await db.from('brands').select('id,slug'), 'marca del operador');
  check(brands.length === 1 && brands[0].id === brand, 'Operador limitado a su marca');
  actor.fracc = ok(await db.from('fraccionamientos').insert({ name: `Synthetic endpoint ${run}`, slug: `endpoint-${run}` }).select('id').single(), 'crear zona');
  for (let i = 0; i < (name === 'VVN' ? 3 : 1); i++) {
    const venue = ok(await db.from('venues').insert({ owner_id: login.user.id, name: `Synthetic endpoint ${run} ${name} ${i}`, type: 'both', lat: 20.7, lng: -103.4, location_reference: 'Synthetic integration fixture', fraccionamiento_id: actor.fracc.id, is_active: true, is_premium: i !== 2 }).select('id,name').single(), 'crear venue');
    actor.venues.push(venue);
  }
  return actor;
}

try {
  const own = await fixture('VVN', conf.BRAND_OPERATOR_EMAIL, conf.BRAND_OPERATOR_PASSWORD, conf.VVN_BRAND_ID);
  const foreign = await fixture('OTHER', otherConf.TEST_OTHER_OPERATOR_EMAIL, otherConf.TEST_OTHER_OPERATOR_PASSWORD, otherConf.TEST_OTHER_BRAND_ID);
  const [venue, second, basic] = own.venues;
  const reservation = createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  base = `http://127.0.0.1:${port}`;
  const childEnv = { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), HOSTNAME: '127.0.0.1', NEXT_TELEMETRY_DISABLED: '1', SENTRY_DSN: '', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' };
  for (const key of ['VVN_ENVIRONMENT', 'VVN_EXPECTED_SUPABASE_PROJECT_REF', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY', 'VVN_BRAND_ID', 'BRAND_OPERATOR_EMAIL', 'BRAND_OPERATOR_PASSWORD', 'RATING_SALT', 'NEXT_PUBLIC_VVN_SITE_URL']) childEnv[key] = conf[key];
  api = spawn(process.execPath, ['--import', new URL('./test-supabase-network-only.mjs', import.meta.url).href, '.next/standalone/server.js'], { env: childEnv, stdio: ['ignore', 'ignore', 'pipe'] });
  // Consumir stderr sin publicar payloads o credenciales de los fixtures.
  api.stderr.resume();
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) { ready = true; break; } } catch {}
    if (api.exitCode !== null) throw Error('El servidor no pudo iniciar');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  check(ready, 'Servidor de staging disponible');

  const discoverPath = `/descubre?fraccionamiento=endpoint-${run}`;
  const empty = (await request(discoverPath)).data;
  check(!empty.featured_venues.visible && empty.featured_venues.items.length === 0, 'Destacados vacíos ocultos');
  const placements = ok(await own.db.from('vvn_featured_venues').insert(own.venues.slice(0, 2).map((v, position) => ({ venue_id: v.id, position, is_active: true }))).select('id,venue_id'), 'crear destacados');
  const campaigns = ok(await own.db.from('vvn_sponsored_campaigns').insert([
    { title: 'Synthetic survey', image_url: 'https://example.invalid/survey.webp', kind: 'survey', target_type: 'url', target_url: 'https://example.invalid/survey', fraccionamiento_id: own.fracc.id, position: 0, is_active: true },
    { title: 'Synthetic venue', image_url: 'https://example.invalid/venue.webp', kind: 'venue', target_type: 'venue', venue_id: venue.id, fraccionamiento_id: own.fracc.id, position: 1, is_active: true },
    { title: 'Synthetic inactive', image_url: 'https://example.invalid/off.webp', kind: 'survey', target_type: 'url', target_url: 'https://example.invalid/off', fraccionamiento_id: own.fracc.id, is_active: false },
    { title: 'Synthetic future', image_url: 'https://example.invalid/future.webp', kind: 'survey', target_type: 'url', target_url: 'https://example.invalid/future', fraccionamiento_id: own.fracc.id, is_active: true, starts_at: '2099-01-01T00:00:00Z' },
    { title: 'Synthetic expired', image_url: 'https://example.invalid/past.webp', kind: 'survey', target_type: 'url', target_url: 'https://example.invalid/past', fraccionamiento_id: own.fracc.id, is_active: true, starts_at: '2020-01-01T00:00:00Z', ends_at: '2020-01-02T00:00:00Z' },
  ].map(row => ({ starts_at: '2020-01-01T00:00:00Z', position: 0, ...row }))).select('id,title'), 'crear campañas');
  const foreignCampaign = ok(await foreign.db.from('vvn_sponsored_campaigns').insert({ title: 'Synthetic foreign', image_url: 'https://example.invalid/foreign.webp', kind: 'survey', target_type: 'url', target_url: 'https://example.invalid/foreign', fraccionamiento_id: foreign.fracc.id, is_active: true }).select('id').single(), 'campaña ajena');
  const first = await request(`${discoverPath}&limit=1`);
  check(first.data.featured_venues.items.length === 1 && first.data.featured_venues.total === 2, 'Destacados paginados');
  check(first.data.sponsored.items[0].target.type === 'url', 'Patrocinado externo');
  const next = (await request(`${discoverPath}&limit=1&featured_cursor=${first.data.featured_venues.next_cursor}&sponsored_cursor=${first.data.sponsored.next_cursor}`)).data;
  check(next.featured_venues.items[0].venue.id === second.id, 'Cursor independiente destacado');
  check(next.sponsored.items[0].target.venue_id === venue.id, 'Destino de negocio');
  await request(`${discoverPath}&limit=1`, { status: 304, headers: { 'If-None-Match': first.response.headers.get('etag') } });
  const all = (await request(discoverPath)).data;
  check(all.sponsored.items.length === 2, 'No publica inactivos, futuros o vencidos');
  check(!JSON.stringify(all).includes(foreignCampaign.id), 'Descubre no mezcla marcas');
  check(!Object.hasOwn(all.featured_venues.items[0].venue, 'owner_id'), 'DTO público sin owner_id');
  check(!Object.hasOwn(all.featured_venues.items[0].venue.contact, 'bot_phone'), 'DTO público sin bot_phone');
  check(ok(await own.db.from('analytics_events').select('id').eq('entity_id', venue.id), 'eventos tras GET').length === 0, 'Leer Descubre no genera impresiones');
  const before = ok(await own.db.from('venues').select('views').eq('id', venue.id).single(), 'vistas antes').views;
  await request('/track', { body: { event: 'featured_open', entityType: 'venue', entityId: venue.id, platform: 'ios', meta: { placement_id: placements.find(p => p.venue_id === venue.id).id } } });
  check(ok(await own.db.from('venues').select('views').eq('id', venue.id).single(), 'vistas después').views === before, 'Atribución sin duplicar vistas');
  await request('/track', { body: { event: 'sponsored_click', platform: 'android', meta: { campaign_id: campaigns[0].id } } });
  eventIds.push(...ok(await own.db.from('analytics_events').select('id').contains('meta', { campaign_id: campaigns[0].id }), 'evento de campaña').map(e => e.id));
  check(eventIds.length === 1, 'Campaña atribuida exactamente una vez');
  await request('/track', { status: 400, body: { event: 'sponsored_click', meta: { campaign_id: foreignCampaign.id } } });
  await request('/track', { status: 400, body: { event: 'sponsored_click', meta: { campaign_id: campaigns[4].id } } });
  console.log('Descubre y atribución: HTTP, paginación, vigencia, privacidad y métricas correctos.');

  await request('/owner', { status: 401 });
  const payload = await invite(own, venue);
  const auth = { session: secret(), device: secret() };
  const wrong = { session: secret(), device: secret() };
  await request('/owner', { body: { operation: 'preview', payload: payload.replace(':staging:', ':production:') }, status: 400 });
  const preview = (await request('/owner', { body: { operation: 'preview', payload } })).data;
  check(preview.venue_id === venue.id && !Object.hasOwn(preview, 'session_hash'), 'Vista previa segura del QR');
  await request('/owner', { body: { operation: 'claim', payload }, status: 401 });
  await request('/owner', { auth, body: { operation: 'claim', payload } });
  await request('/owner', { auth, body: { operation: 'claim', payload } });
  const reused = await request('/owner', { auth: wrong, body: { operation: 'claim', payload }, status: 400 });
  check(reused.json.error === 'invitation_unavailable', 'Segundo dispositivo rechazado');
  const secondPayload = await invite(own, second);
  const linked = await request('/owner', { auth: { session: secret(), device: auth.device }, body: { operation: 'claim', payload: secondPayload }, status: 400 });
  check(linked.json.error === 'device_linked', 'Un dispositivo solo tiene un negocio');
  await request('/owner', { auth: wrong, status: 401 });
  const foreignPayload = await invite(foreign, foreign.venues[0]);
  await request('/owner', { auth: wrong, body: { operation: 'claim', payload: foreignPayload }, status: 401 });
  check((await rpc(own, 'admin_invite', { venue_id: basic.id, invitation_hash: hash(secret()) })).error === 'pro_required', 'QR requiere Pro');
  const initial = await read(auth);
  for (const key of ['owner_id', 'brand_id', 'paid_until', 'bot_phone', 'session_hash', 'device_hash']) check(!Object.hasOwn(initial.venue, key), `Ficha privada limitada: ${key}`);
  await save(auth, 'info', { description: 'Synthetic owner edit', tags: ['synthetic'] });
  check((await read(auth)).venue.description === 'Synthetic owner edit', 'Edición de información persistida');
  await save(auth, 'contact', { phone: '0000000000', website_url: 'https://example.invalid' });
  await save(auth, 'location', { address: 'Synthetic address', lat: 20.71, lng: -103.41 });
  const hours = Array.from({ length: 7 }, () => ({ closed: false, open: '09:00', close: '20:00', intervals: [{ open: '09:00', close: '13:00' }, { open: '16:00', close: '20:00' }] }));
  await save(auth, 'hours', { opening_hours: hours, status: 'open' });
  check((await read(auth)).venue.opening_hours[0].intervals.length === 2, 'Horario dividido persistido');
  await save(auth, 'daily', { daily_text: 'Synthetic text', daily_image_url: null });
  await save(auth, 'daily', { daily_image_url: null });
  const daily = (await read(auth)).venue;
  check(daily.daily_text === 'Synthetic text' && !!daily.daily_updated_at, 'Edición parcial conserva texto y frescura');
  await save(auth, 'daily', { daily_text: null });
  check((await read(auth)).venue.daily_updated_at === null, 'Post vacío sin fecha');

  const imageBytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const image = (await request('/owner/media', { auth, bytes: imageBytes, type: 'image/png' })).data.url;
  const recordObject = url => { const parts = new URL(url).pathname.split('/object/public/')[1].split('/'); objects.push({ db: own.db, bucket: parts.shift(), path: parts.join('/') }); };
  recordObject(image);
  check(image.includes(`/venue-media/${own.brand}/owners/${venue.id}/`) && image.endsWith('.webp'), 'Imagen WebP en namespace de marca');
  const download = await fetch(image);
  check(download.ok && (await sharp(Buffer.from(await download.arrayBuffer())).metadata()).format === 'webp', 'Imagen publicada y decodificable');
  // PDF mínimo válido con xref, sin documentos o datos reales.
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, content] of ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [] /Count 0 >>'].entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${content}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 3\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const catalog = (await request('/owner/media', { auth, bytes: Buffer.from(pdf), type: 'application/pdf' })).data.url;
  recordObject(catalog);
  check(catalog.includes(`/venue-catalogs/${own.brand}/owners/${venue.id}/`) && catalog.endsWith('.pdf'), 'PDF en bucket de catálogos');
  const pdfDownload = await fetch(catalog);
  check(pdfDownload.ok && (await pdfDownload.text()) === pdf, 'PDF persistido sin alteraciones');
  const prepared = (await request('/owner/media', { auth, body: { operation: 'prepare_pdf' } })).data;
  recordObject(prepared.url);
  check((await fetch(prepared.upload_url, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from(pdf) })).ok, 'Subida firmada de PDF');
  await request('/owner/media', { auth, body: { operation: 'confirm_pdf', url: prepared.url } });
  await request('/owner/media', { auth, body: { operation: 'confirm_pdf' }, status: 400 });
  await request('/owner/media', { auth, body: null, status: 400 });
  await save(auth, 'branding', { logo_url: image, cover_url: image });
  await save(auth, 'catalog', { catalog_pdf_url: catalog, catalog_updated_on: '2026-11-27' });
  await save(auth, 'branding', { logo_url: catalog }, {}, 400);
  await save(auth, 'catalog', { catalog_pdf_url: image }, {}, 400);
  await request('/owner/media', { auth, bytes: Buffer.from('not an image'), type: 'image/png', status: 400 });
  await request('/owner/media', { auth, bytes: Buffer.from('not a PDF'), type: 'application/pdf', status: 400 });
  await request('/owner/media', { auth, bytes: Buffer.from('text'), type: 'text/plain', status: 400 });
  await request('/owner/media', { auth: wrong, bytes: imageBytes, type: 'image/png', status: 401 });

  for (const [section, collection, values] of [
    ['menu', 'menu', { name: 'Synthetic item', price: 25, image_url: image }],
    ['services', 'services', { name: 'Synthetic service', price: 50, duration: 30 }],
    ['photos', 'photos', { url: image }],
    ['promotions', 'promotions', { title: 'Synthetic coupon', kind: 'coupon', code: 'test', is_active: true }],
  ]) {
    await save(auth, section, values);
    const created = (await read(auth))[collection][0];
    check(!!created?.id && !Object.hasOwn(created, 'brand_id'), `${section}: alta y DTO`);
    await save(auth, section, section === 'photos' ? { order: 1 } : section === 'promotions' ? { title: 'Synthetic updated' } : { name: 'Synthetic updated' }, { item_id: created.id });
    await save(auth, section, {}, { item_id: created.id, delete: true });
    check((await read(auth))[collection].length === 0, `${section}: baja persistida`);
  }
  const retryRevision = (await read(auth)).revision;
  const retryBody = { operation: 'save', section: 'menu', values: { name: 'Synthetic retry' }, revision: retryRevision };
  await request('/owner', { auth, body: retryBody });
  await request('/owner', { auth, body: retryBody });
  const retried = (await read(auth)).menu;
  check(retried.length === 1, 'Reintento HTTP no duplica elementos');
  await save(auth, 'menu', {}, { item_id: retried[0].id, delete: true });
  const stale = (await read(auth)).revision;
  const race = await Promise.all([0, 1].map(i => fetch(`${base}/api/v1/owner`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.session}`, 'X-Vvn-Device': auth.device, 'X-Forwarded-For': `198.51.100.${i + 1}` }, body: JSON.stringify({ operation: 'save', section: 'info', values: { description: `Synthetic race ${i}` }, revision: stale }) })));
  check(race.map(r => r.status).sort().join(',') === '200,409', 'Ediciones concurrentes: una escritura y un conflicto');
  await save(auth, 'info', { owner_id: 'forbidden' }, {}, 400);
  const revision = (await read(auth)).revision;
  ok(await own.db.rpc('increment_venue_views', { venue_id: venue.id }), 'incrementar vistas');
  check((await read(auth)).revision === revision, 'Métricas no causan conflictos editoriales');
  await rpc(own, 'admin_revoke', { venue_id: venue.id });
  await request('/owner', { auth, status: 401 });
  await request('/owner/media', { auth, bytes: imageBytes, type: 'image/png', status: 401 });
  const renewedPayload = await invite(own, venue);
  const renewed = { session: secret(), device: secret() };
  await request('/owner', { auth: renewed, body: { operation: 'claim', payload: renewedPayload } });
  ok(await own.db.from('venues').update({ is_premium: false }).eq('id', venue.id), 'desactivar Pro');
  await request('/owner', { auth: renewed, status: 401 });
  ok(await own.db.from('venues').update({ is_premium: true }).eq('id', venue.id), 'reactivar Pro');
  await request('/owner', { auth: renewed, status: 401 });
  console.log(`${checks} comprobaciones de endpoints nuevos correctas contra vvn-pruebas.`);
  mkdirSync('.test-results', { recursive: true });
  writeFileSync('.test-results/new-endpoints-verification.json', JSON.stringify({ verifiedAt: new Date().toISOString(), projectUrl: TEST_URL, checks }, null, 2), { mode: 0o600 });
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falló la integración de endpoints nuevos');
  process.exitCode = 1;
} finally {
  if (api && api.exitCode === null) { api.kill('SIGTERM'); await once(api, 'exit'); }
  for (const object of objects) {
    const result = await object.db.storage.from(object.bucket).remove([object.path]);
    if (result.error) { console.error('No se pudo limpiar un archivo sintético'); process.exitCode = 1; }
  }
  for (const actor of actors) {
    const ids = actor.venues.map(v => v.id);
    if (ids.length) {
      const results = [
        await actor.db.from('analytics_events').delete().in('entity_id', ids),
        ...(eventIds.length ? [await actor.db.from('analytics_events').delete().in('id', eventIds)] : []),
        await actor.db.from('venues').delete().in('id', ids),
      ];
      if (results.some(result => result.error)) { console.error('No se pudieron limpiar todos los fixtures de negocio'); process.exitCode = 1; }
    }
    if (actor.fracc) {
      const result = await actor.db.from('fraccionamientos').delete().eq('id', actor.fracc.id);
      if (result.error) { console.error('No se pudo limpiar una zona sintética'); process.exitCode = 1; }
    }
  }
}
