import 'server-only';
import {createSupabaseAdmin} from '@/lib/supabase-admin';
import {deploymentBrandId} from '@/lib/deployment-brand';
/** Verify immutable storage objects before accepting a reference in an owner write. */
export async function verifyOwnerMedia(values:Record<string,unknown>,venueId:string) {
 const keys=['logo_url','cover_url','catalog_pdf_url','daily_image_url','image_url','url'];
 for(const key of keys){
  const url=values[key];if(!url)continue;
  const pdf=key==='catalog_pdf_url';
  const prefix=createSupabaseAdmin().storage.from(pdf?'venue-catalogs':'venue-media').getPublicUrl(`${deploymentBrandId}/owners/${venueId}/`).data.publicUrl;
  if(typeof url!=='string'||!url.startsWith(prefix))throw new Error('Invalid media reference');
  const response=await fetch(url,{headers:{Range:'bytes=0-15'},cache:'no-store',signal:AbortSignal.timeout(15000)});
  const total=Number(response.headers.get('content-range')?.split('/')[1]??response.headers.get('content-length'));
  if(!new RegExp(`^[a-f0-9-]{36}\\.${pdf?'pdf':'webp'}$`).test(url.slice(prefix.length)))throw new Error('Invalid media format');
  const reader=response.body?.getReader();const chunk=await reader?.read();await reader?.cancel();
  if(!response.ok||!chunk?.value||!Number.isFinite(total)||total<=0||total>(pdf?80:8)*1024*1024)throw new Error('Invalid media file');
  const header=Buffer.from(chunk.value);
  if(pdf ? header.subarray(0,5).toString()!=='%PDF-' : header.subarray(0,4).toString()!=='RIFF'||header.subarray(8,12).toString()!=='WEBP')throw new Error('Invalid media format');
 }
}
