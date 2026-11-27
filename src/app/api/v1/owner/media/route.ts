import sharp from 'sharp';
import {verifyOwnerMedia} from '@/server/owner/media';
import {randomUUID} from 'node:crypto';
import {createSupabaseAdmin} from '@/lib/supabase-admin';
import {deploymentBrandId} from '@/lib/deployment-brand';
import {credentials,ownerRpc} from '@/server/owner/service';
import {ownerResponse} from '@/server/owner/respond';
import {apiOk,apiError,apiServerError,CACHE_PRIVATE,apiRateLimited} from '@/server/api/respond';
import {consumeRateLimit,getRequestClientIp} from '@/lib/rate-limit';
export const runtime='nodejs';
export async function POST(req:Request){
 try{
  const limit=await consumeRateLimit('admin-write',`owner-media:${getRequestClientIp(req)}`);
  if(!limit.ok)return apiRateLimited(limit.headers);
  const auth=credentials(req);if(!auth)return apiError('unauthorized',401);
  const access=await ownerRpc('authorize',auth);if(access.error)return ownerResponse(req,access);
  const type=req.headers.get('content-type')?.split(';')[0];
  if(type==='application/json'){
   const text=await req.text();if(text.length>4096)return apiError('invalid',413);
   let body;try{body=JSON.parse(text)}catch{return apiError('invalid_body',400)}
   if(!body||typeof body!=='object'||Array.isArray(body))return apiError('invalid_body',400);
   if(body.operation==='prepare_pdf'){
    const path=`${deploymentBrandId}/owners/${access.venue_id}/${randomUUID()}.pdf`;
    const {data,error}=await createSupabaseAdmin().storage.from('venue-catalogs').createSignedUploadUrl(path,{upsert:false});
    if(error||!data)throw new Error('Could not prepare PDF upload');
    return apiOk(req,{upload_url:data.signedUrl,url:createSupabaseAdmin().storage.from('venue-catalogs').getPublicUrl(path).data.publicUrl},CACHE_PRIVATE);
   }
   if(body.operation==='confirm_pdf'){
    if(typeof body.url!=='string'||!body.url)return apiError('invalid',400,'Selecciona un PDF subido para este negocio.');
    try{await verifyOwnerMedia({catalog_pdf_url:body.url},String(access.venue_id))}catch{return apiError('invalid',400,'No se pudo verificar el PDF. Intenta subirlo de nuevo.')}
    return apiOk(req,{url:body.url},CACHE_PRIVATE);
   }
   return apiError('invalid',400);
  }
  const pdf=type==='application/pdf';const max=pdf?80*1024*1024:8*1024*1024;
  if(!pdf&&!['image/jpeg','image/png','image/webp'].includes(type??''))return apiError('invalid',400,'Usa JPG, PNG, WebP o PDF.');
  if(Number(req.headers.get('content-length'))>max)return apiError('invalid',413,'Archivo demasiado grande.');
  // Stream with a hard bound; never buffer an unlimited client body.
  const reader=req.body?.getReader();if(!reader)return apiError('invalid',400);
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();return apiError('invalid',413,'Archivo demasiado grande.')}chunks.push(value)}
  let bytes:Buffer=Buffer.concat(chunks);if(!bytes.length)return apiError('invalid',400);
  if(pdf){if(bytes.subarray(0,5).toString()!=='%PDF-')return apiError('invalid',400,'PDF inválido.')}else{
   try{bytes=await sharp(bytes,{limitInputPixels:40_000_000}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).webp({quality:78}).toBuffer()}catch{return apiError('invalid',400,'No se pudo leer la imagen.')}
  }
  // Revocation during a long upload is checked before creating a storage object.
  const finalAccess=await ownerRpc('authorize',auth);if(finalAccess.error)return ownerResponse(req,finalAccess);
  const db=createSupabaseAdmin();const path=`${deploymentBrandId}/owners/${access.venue_id}/${randomUUID()}.${pdf?'pdf':'webp'}`;
  const bucket=pdf?'venue-catalogs':'venue-media';
  const {error}=await db.storage.from(bucket).upload(path,bytes,{contentType:pdf?'application/pdf':'image/webp',upsert:false});
  if(error)throw new Error('Owner upload failed');
  return apiOk(req,{url:db.storage.from(bucket).getPublicUrl(path).data.publicUrl},CACHE_PRIVATE);
 }catch(e){return apiServerError('owner/media POST',e)}
}
