# Acceso de propietarios VVN

Estado: código local y migraciones verificadas en vvn-pruebas. Sin despliegue a
producción. Las apps son clientes de VVN-API; el admin emite la invitación desde
la ficha del venue y conserva sus permisos generales.

## Vinculación y reglas

Un negocio Pro por instalación y una instalación por negocio. La app muestra
nombre/portada antes de confirmar. Un QR pendiente dura 24 horas y se canjea una
sola vez; regenerarlo cancela el anterior. Cambiar teléfono exige revocación
previa desde admin. Retirar Pro o vencer paid_until revoca definitivamente el
acceso; renovar requiere otro QR. Vigencia nula significa sin vencimiento
programado. paid_until es la fecha capturada por el admin (parte UTC del valor
legacy), comparada con el día actual de America/Mexico_City.

El QR tiene formato `vvn-owner:<staging|production>:<secreto-hex-256-bits>`.
La base conserva únicamente hashes SHA-256. La app genera y guarda de forma
segura dos secretos aleatorios: sesión y credencial de instalación. Se persiste
el canje pendiente antes de enviarlo para poder recuperar una respuesta perdida.
El canje idéntico es idempotente; otro dispositivo no puede reutilizarlo.

No usar owner_id legacy, número celular, X-Visitor-Id ni tokens push para este
permiso. Keychain ThisDeviceOnly y Android Keystore/noBackup evitan transferir
la credencial en respaldos. Reinstalar exige revocación y nuevo QR.

## Contrato privado

Todas las respuestas incluyen X-Vvn-Environment, `{ok,data}` o
`{ok:false,error,message?}`, y `Cache-Control: private, no-store`. Nunca exponer
sesiones, hashes ni vigencia privada en el DTO público del directorio.

- `POST /api/v1/owner`: `operation: preview`, `payload`: consulta nombre,
  venue_id, cover_url y expires_at sin consumir la invitación.
- `POST /api/v1/owner`: `operation: claim`, `payload`, más
  `Authorization: Bearer <sesión>` y `X-Vvn-Device: <credencial-instalación>`.
- `GET /api/v1/owner`, con ambas credenciales: venue editable, revision y listas
  menu, services, photos y promotions. Nunca datos de pago, bot o controles admin.
- `POST /api/v1/owner`: `operation: save`, `section`, `revision`, `values`,
  `item_id?`, `delete?`. Enviar solo cambios. Para agregar un elemento no enviar
  item_id; para eliminarlo usar item_id y delete:true. El servidor deriva el
  venue de la sesión, nunca de un venue_id suministrado por el dueño.
- Apartados: info, contact, location, hours, branding, catalog, daily, menu,
  services, photos y promotions. La lista permitida de campos vive en
  `src/server/owner/validation.ts` y se vuelve a limitar en la RPC.
- Revisiones detectan cambios de admin/bot y colecciones. Los contadores de
  métricas no provocan conflictos. Un hash de la escritura y la sesión permite
  reconocer reintentos confirmados sin duplicar contenido.
- Errores relevantes: unauthorized (401), pro_required (403), conflict (409),
  invitation_unavailable, already_linked, device_linked, photo_limit, invalid.
  Las apps conservan el formulario ante red/validación y piden recargar en conflicto.

### Archivos

`POST /api/v1/owner/media` acepta imágenes JPG/PNG/WebP (hasta 8 MB), las valida,
rota y optimiza a WebP. Revalida autorización antes de crear el objeto.

Para PDF (hasta 80 MB), enviar JSON `operation: prepare_pdf`; devuelve upload_url
y url pública. Subir el binario mediante PUT a la URL temporal, sin credenciales
de operador. Después enviar JSON `operation: confirm_pdf`, url. El servidor
comprueba encabezado y tamaño antes de devolverla. Al guardar referencias de
archivos vuelve a verificar marca, venue, ruta, extensión, tamaño y firma.

Ruta canónica: `{brand_uuid}/owners/{venue_uuid}/{file_uuid}`. Imágenes en
venue-media y PDF en venue-catalogs. Las subidas no sobrescriben archivos.
Quitar una referencia de la ficha no borra inmediatamente el objeto físico;
la limpieza de archivos huérfanos requiere una política posterior de retención.

## Admin y base de datos

El panel está en ClickLocalWebApp, dentro de `/admin/venues/[id]`. Las Server
Actions verifican la sesión admin y la marca del venue. Configurar
`VVN_OWNER_ENVIRONMENT=staging|production` antes de generar QR. Nunca inferir el
ambiente desde un parámetro del navegador. Funciones: generar/cancelar QR,
consultar estado, revocar y revisar las últimas 20 operaciones.

`public.vvn_owner_api` es SECURITY INVOKER y solo admite operador autenticado de
la marca o el servidor admin existente. No está disponible para anon. Las tablas
private.vvn_owner_access, vvn_owner_audit y vvn_owner_receipts usan RLS por marca.
El bloqueo del venue serializa canje, revocación y edición. Los triggers de
contenido actualizan owner_revision; la historia conserva los campos editables,
sin secretos. No añadir service-role fallback a VVN-API.

La última migración conciliada es owner_media_brand_paths. Mantener el orden
registrado en supabase/migrations; no aplicar únicamente la migración inicial.

## Verificación y pendientes

- `npm test`, `npm run build:local`, `npm run smoke:local`.
- `node scripts/verify-owner-access.mjs`: pruebas reales de Auth/PostgREST/Storage
  limitadas al proyecto vvn-pruebas; crea y elimina sus datos sintéticos.
- `npm run build:staging` y `node scripts/verify-test-new-endpoints.mjs`: contrato
  HTTP real de rutas nuevas, aislamiento y archivos; también limpia fixtures.
- Apps: `:shared:allTests`, Android assembleStagingDebug, build iOS y prueba
  VVNUITests/OwnerAccessTests. La cámara debe probarse también en teléfonos físicos.
- Validar propagación por CDN/cachés en los despliegues reales. La escritura se
  publica sin moderación; no prometer que una caché externa ya se invalidó sin
  haberlo comprobado. Producción permanece sin despliegue ni migraciones nuevas.
