import {verifyOwnerMedia} from '@/server/owner/media';
import {ownerResponse} from '@/server/owner/respond';
import {ownerRpc,credentials,invitationHash,hashSecret} from '@/server/owner/service';
import {validateSave,OwnerValidationError} from '@/server/owner/validation';
import {apiOk,apiError,apiServerError,CACHE_PRIVATE,apiRateLimited} from '@/server/api/respond';
import {consumeRateLimit,getRequestClientIp} from '@/lib/rate-limit';
import {revalidatePath,revalidateTag} from 'next/cache';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(req:Request) {
 try {
  const auth=credentials(req);if(!auth)return apiError('unauthorized',401);
  return ownerResponse(req,await ownerRpc('read',auth));
 }catch(e){return apiServerError('owner GET',e)}
}
export async function POST(req:Request) {
 try {
  const limit=await consumeRateLimit('admin-write',`owner:${getRequestClientIp(req)}`);
  if(!limit.ok)return apiRateLimited(limit.headers);
  const text=await req.text();if(text.length>65536)return apiError('invalid',413);
  let body:Record<string,unknown>;try{body=JSON.parse(text)}catch{return apiError('invalid_body',400)}
  if(!body||Array.isArray(body)||typeof body!=='object')return apiError('invalid_body',400);
  const op=String(body.operation);
  if(op==='preview'||op==='claim') {
   const hash=invitationHash(body.payload);if(!hash)return apiError('invalid',400,'QR inválido o de otro ambiente.');
   const auth=credentials(req);
   if(op==='claim'&&!auth)return apiError('unauthorized',401);
   return ownerResponse(req,await ownerRpc(op,{invitation_hash:hash,...(auth??{})}));
  }
  const auth=credentials(req);if(!auth)return apiError('unauthorized',401);
  if(op!=='save')return apiError('invalid',400);
  const access=await ownerRpc('authorize',auth);if(access.error)return ownerResponse(req,access);
  const clean=validateSave(body,String(access.venue_id),process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/,''));
  if(clean.section==='promotions'&&!clean.delete){
   const current=await ownerRpc('read',auth);if(current.error)return ownerResponse(req,current);
   const previous=(current.promotions as Record<string,unknown>[]).find(item=>item.id===clean.item_id)??{};
   const dates={...previous,...clean.values};
   if(dates.starts_at&&dates.ends_at&&Date.parse(String(dates.ends_at))<=Date.parse(String(dates.starts_at)))return apiError('invalid',400,'El fin debe ser posterior al inicio.');
  }
  try{await verifyOwnerMedia(clean.values as Record<string,unknown>,String(access.venue_id))}catch{return apiError('invalid',400,'El archivo no está disponible o no pertenece a este negocio. Vuelve a seleccionarlo.')}
  const canonical=JSON.stringify([auth.session_hash,clean.revision,clean.section,clean.item_id??null,clean.delete??false,Object.fromEntries(Object.entries(clean.values as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)))]);
  const result=await ownerRpc('save',{...clean,...auth,request_hash:hashSecret(canonical)});
  if(!result.error){
   for(const tag of ['venues','vvn','feed','promotions'])revalidateTag(tag,{expire:0});
   for(const path of ['/api/v1/feed','/api/v1/cupones','/api/v1/descubre',`/api/v1/venues/${access.venue_id}`])revalidatePath(path);
  }
  return ownerResponse(req,result);
 }catch(e){if(e instanceof OwnerValidationError)return apiError('invalid',400,e.message);return apiServerError('owner POST',e)}
}
