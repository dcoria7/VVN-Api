import {deploymentBrandId} from '@/lib/deployment-brand';
export class OwnerValidationError extends Error {}
const sections: Record<string, string[]> = {
 info:['name','type','category','description','tags'], contact:['phone','instagram','contact_cta','website_url','rappi_url','didi_url','uber_eats_url'],
 location:['address','lat','lng','location_reference','local_number','floor','location_note','is_ambulatory','is_closed_door'], hours:['opening_hours','status'],
 branding:['logo_url','cover_url'], catalog:['catalog_pdf_url','catalog_updated_on'],daily:['daily_text','daily_image_url'],
 menu:['name','description','price','image_url','category','is_available','order'], services:['name','description','price','duration','image_url','is_available','order'],
 photos:['url','order'],promotions:['kind','title','description','discount_label','code','image_url','terms','starts_at','ends_at','is_active'],
};
export const secretPattern=/^[a-f0-9]{64}$/;
export const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=(message:string):never=>{throw new OwnerValidationError(message)};
export function validateSave(body:Record<string,unknown>,venueId:string,storageBase:string) {
 const section=String(body.section); const values=body.values;
 if(!Object.hasOwn(sections,section) || !values || typeof values!=='object' || Array.isArray(values)) fail('Apartado inválido.');
 if(!Number.isSafeInteger(body.revision) || Number(body.revision)<0) fail('Recarga la ficha antes de guardar.');
 if(body.item_id!=null && !uuidPattern.test(String(body.item_id))) fail('Elemento inválido.');
 if(body.delete!=null && typeof body.delete!=='boolean') fail('Operación inválida.');
 if(body.delete && (!body.item_id || !['menu','services','photos','promotions'].includes(section))) fail('Elemento inválido.');
 const clean:Record<string,unknown>={};
 for(const [key,raw] of Object.entries(values as Record<string,unknown>)) {
  if(!sections[section].includes(key)) fail('Este campo solo puede cambiarlo el administrador.');
  let value=typeof raw==='string'?raw.trim():raw;
  if(section==='menu'&&key==='category'&&(value===null||value===''))value='General';
  if(section==='info'&&key==='description'&&value===null)value='';
  const structured=['tags','opening_hours','lat','lng','price','duration','order','is_available','is_active','is_ambulatory','is_closed_door'];
  if(!structured.includes(key)&&value!==null&&typeof value!=='string')fail('Escribe un texto válido.');
  if(value!=null && typeof value==='string' && value.length>(key==='daily_text'?1000:5000)) fail('El texto es demasiado largo.');
  if(['name','title','location_reference'].includes(key) && (typeof value!=='string'||!value||value.length>200)) fail('Completa el nombre, título o referencia (máximo 200 caracteres).');
  if(['is_available','is_active','is_ambulatory','is_closed_door'].includes(key) && typeof value!=='boolean') fail('Valor inválido.');
  if(['lat','lng','price','duration','order'].includes(key) && !(value===null&&['price','duration'].includes(key))) {
   if(typeof value!=='number'||!Number.isFinite(value)) fail('Escribe un número válido.');
   const n=Number(value);
   if(key==='lat'&&Math.abs(n)>90||key==='lng'&&Math.abs(n)>180||['price','duration','order'].includes(key)&&n<0) fail('Número fuera de rango.');
   if(['duration','order'].includes(key)&&!Number.isSafeInteger(n)) fail('Escribe un número entero.');
  }
  const options:Record<string,string[]>={type:['food','service','both','product'],status:['open','closed'],contact_cta:['whatsapp','website'],kind:['promo','coupon']};
  if(options[key]&&!options[key].includes(String(value))) fail('Elige una opción válida.');
  if(key==='tags'&&(!Array.isArray(value)||value.length>20||value.some(t=>typeof t!=='string'||t.length>60))) fail('Usa hasta 20 etiquetas de 60 caracteres.');
  if(key==='opening_hours'&&value!==null) validateHours(value);
  if(['website_url','rappi_url','didi_url','uber_eats_url'].includes(key)&&value) {
   let url:URL;try{url=new URL(String(value))}catch{fail('Escribe una dirección https válida.')}
   if(url!.protocol!=='https:'||url!.username||url!.password) fail('Usa un enlace https sin credenciales.');
  }
  if(['logo_url','cover_url','catalog_pdf_url','daily_image_url','image_url','url'].includes(key)&&value!=null&&value!=='') {
   // Only files uploaded for THIS venue; arbitrary remote URLs cannot be attached.
   const pdf=key==='catalog_pdf_url';
   const prefix=`${storageBase}/storage/v1/object/public/${pdf?'venue-catalogs':'venue-media'}/${deploymentBrandId}/owners/${venueId}/`;
   if(typeof value!=='string'||!value.startsWith(prefix)||!new RegExp(`^[a-f0-9-]{36}\\.${pdf?'pdf':'webp'}$`).test(value.slice(prefix.length))) fail('Selecciona un archivo subido para este negocio y del tipo correcto.');
  }
  if(['starts_at','ends_at','catalog_updated_on'].includes(key)&&value && (typeof value!=='string'||!Number.isFinite(Date.parse(value)))) fail('Fecha inválida.');
  if(['starts_at','ends_at','catalog_updated_on'].includes(key)&&typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)) {
   if(new Date(value).toISOString().slice(0,10)!==value)fail('Fecha inválida.');
   if(key!=='catalog_updated_on')value+=key==='ends_at'?'T23:59:59-06:00':'T00:00:00-06:00';
  }
  if(key==='code'&&typeof value==='string') value=value.toUpperCase();
  clean[key]=value;
 }
 if(!body.delete&&!Object.keys(clean).length) fail('No hay cambios para guardar.');
 if(!body.item_id && !body.delete && ['menu','services','photos','promotions'].includes(section)) {
  const required=section==='photos'?'url':section==='promotions'?'title':'name';
  if(!clean[required]) fail('Completa los campos obligatorios.');
 }
 if(clean.starts_at&&clean.ends_at&&Date.parse(String(clean.ends_at))<=Date.parse(String(clean.starts_at))) fail('El fin debe ser posterior al inicio.');
 return {...body,revision:body.revision as number,item_id:body.item_id as string|undefined,delete:body.delete as boolean|undefined,section,values:clean};
}
function validateHours(raw:unknown) {
 if(!Array.isArray(raw)||raw.length!==7) fail('Configura los siete días.');
 const time=/^([01]\d|2[0-3]):[0-5]\d$/;
 for(const d of raw as Record<string,unknown>[]) {
  if(!d||typeof d.closed!=='boolean'||!time.test(String(d.open))||!time.test(String(d.close))) fail('Revisa los horarios (HH:mm).');
  if(d.intervals!=null) {
   if(!Array.isArray(d.intervals)||d.intervals.length<1||d.intervals.length>3) fail('Usa entre uno y tres intervalos por día.');
   for(const i of d.intervals as {open:string;close:string}[]) if(!i||!time.test(i.open)||!time.test(i.close)||i.open===i.close) fail('Revisa los intervalos.');
  }
 }
}
