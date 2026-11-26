// Solo para smoke: impide que fetch de la API salga del stub PostgREST local,
// incluso si alguien recompila el proyecto con NEXT_PUBLIC_* de otro entorno.
const originalFetch = globalThis.fetch;
globalThis.fetch = function(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin !== 'http://127.0.0.1:54321') {
    throw new Error('Smoke local: bloqueada una petición fuera del servidor ficticio.');
  }
  return originalFetch.call(this, input, init);
};
