import {apiOk,apiError,CACHE_PRIVATE} from '@/server/api/respond';
const messages:Record<string,string>={unauthorized:'El acceso fue revocado. Solicita un nuevo QR al administrador.',pro_required:'Necesitas Pro vigente y un nuevo QR del administrador.',already_linked:'El negocio ya está vinculado.',device_linked:'Este dispositivo ya está vinculado.',invitation_unavailable:'El QR ya fue usado o venció.',conflict:'La ficha cambió mientras editabas. Recarga antes de guardar.',photo_limit:'Puedes publicar hasta 10 fotos.',invalid:'Revisa los datos.',not_found:'El elemento ya no está disponible.'};
export function ownerResponse(req:Request,data:Record<string,unknown>) {
 if(data.error) {
  const code=String(data.error);return apiError(code as Parameters<typeof apiError>[0],code==='conflict'?409:code==='unauthorized'?401:code==='pro_required'?403:400,messages[code]??'No se pudo completar la operación.');
 }
 return apiOk(req,data,CACHE_PRIVATE);
}
