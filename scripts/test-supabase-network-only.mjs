// Solo para pruebas reales: la API no puede consultar otro proyecto Supabase.
const originalFetch=globalThis.fetch;
globalThis.fetch=function(input,init){
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
  if(url.origin!=='https://msfrkqfvdhyjnktwuhzd.supabase.co'){
    throw new Error('Prueba de integración: conexión fuera de vvn-pruebas bloqueada.');
  }
  return originalFetch.call(this,input,init);
};
