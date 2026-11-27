# Acceso de propietarios

## Estado y alcance

Implementación de API y migraciones verificada en `vvn-pruebas`; el código de
este PR requiere despliegue separado. No confirma que el admin o iOS/Android
estén conectados. Production debe aplicar la cadena completa de migraciones de
propietarios antes de publicar estos endpoints. No se ejecutan SQL al arrancar.

La API usa el operador autenticado del servidor, limitado por marca y RLS.
Los propietarios no reciben credenciales de Supabase. La marca y el ambiente
se obtienen del servidor. Todas las respuestas de propietarios usan
`Cache-Control: private, no-store`, sin ETag y con la envoltura de v1.

## QR y credenciales

`POST /api/v1/owner` recibe `{operation:"preview"|"claim",payload}`.
El payload es `vvn-owner:<staging|production>:<secreto hexadecimal de 64 caracteres>`.
El QR debe emitirlo el admin mediante el RPC autenticado `vvn_owner_api`.
La API pública no permite emitir, cancelar ni revocar invitaciones.

`preview` devuelve solo `venue_id`, `name`, `cover_url` y `expires_at`.
Para `claim` y las operaciones posteriores, enviar:

- `Authorization: Bearer <secreto de sesión de 64 caracteres hexadecimales>`.
- `X-Vvn-Device: <secreto de instalación de 64 caracteres hexadecimales>`.

La app genera ambos secretos aleatorios, los conserva de forma segura y reutiliza
los mismos en reintentos. El servidor almacena hashes SHA-256. El QR vence a las
24 horas; solo un dispositivo puede reclamarlo, y un dispositivo solo puede estar
vinculado a un negocio. Repetir el mismo claim con las mismas credenciales es seguro.
Se requiere Pro vigente; revocar o perder Pro invalida el acceso. Renovar Pro no
restaura las credenciales anteriores: se requiere un QR nuevo.

## Lectura y edición

`GET /api/v1/owner` devuelve `{venue,revision,menu,services,photos,promotions}`.
La ficha tiene una lista explícita de campos editables; no incluye identidad
interna del dueño, teléfono del bot ni facturación.

`POST /api/v1/owner` para guardar:

```json
{"operation":"save","section":"info","values":{"description":"Descripción"},"revision":0}
```

Usar la revisión recibida en la lectura más reciente. El éxito devuelve
`{saved:true}`; volver a leer para obtener la revisión nueva. Una revisión vieja
devuelve `409 conflict`. Repetir exactamente la misma escritura con la misma
revisión y sesión devuelve éxito sin duplicarla. Los contadores no incrementan
la revisión editorial. Las escrituras se registran en auditoría privada.

Secciones: `info`, `contact`, `location`, `hours`, `branding`, `catalog`, `daily`,
`menu`, `services`, `photos` y `promotions`. La lista de campos permitidos está
en `src/server/owner/validation.ts`; no se permite cambiar Pro, marca, dueño,
plaza ni campos internos. Los campos omitidos conservan su valor. `null` elimina
los campos opcionales. El post del día conserva su frescura mientras quede texto
o imagen después de aplicar los cambios.

Las colecciones usan `item_id` para editar. Para borrar, enviar también
`delete:true` y `values:{}`. Sin `item_id`, se crea un elemento. La galería tiene
un límite atómico de diez fotos. Los horarios admiten de uno a tres `intervals`
por día, además de `closed`, `open` y `close`. El override manual vence en la
próxima medianoche de Guadalajara.

Errores: `400 invalid`, `invalid_body`, `invitation_unavailable`, `device_linked`,
`already_linked`, `not_found` o `photo_limit`; `401 unauthorized`;
`403 pro_required`; `409 conflict`; `429 rate_limited`; `500 server_error` genérico.
Los POST tienen límite de veinte peticiones por minuto e IP, por ruta.

## Archivos

`POST /api/v1/owner/media` acepta bytes JPG/PNG/WebP (máximo 8 MiB) y los convierte
a WebP de hasta 1600 × 1600. Devuelve `{url}`. Los PDF van al bucket
`venue-catalogs`; las imágenes a `venue-media`. Las rutas son
`<marca>/owners/<negocio>/<UUID>.<webp|pdf>`, compatibles con la frontera de Storage
que exige el UUID de marca al principio. Solo se pueden asociar archivos del tipo,
marca y negocio correctos; se verifican su existencia y cabecera al guardar.

Para PDF de hasta 80 MiB, usar el flujo de subida directa, que evita el límite
del cuerpo HTTP del proveedor de hosting:

1. POST JSON `{operation:"prepare_pdf"}` con credenciales del propietario.
2. Subir los bytes con `PUT` a `upload_url`, con `Content-Type: application/pdf`.
3. POST JSON `{operation:"confirm_pdf",url}`; la API comprueba el objeto.
4. Guardar `catalog_pdf_url` en la sección `catalog` de `/owner`.

También existe la subida de bytes PDF a `/owner/media` para servidores que
admitan ese tamaño. Una URL firmada emitida puede seguir permitiendo la subida
hasta su vencimiento; confirmar y asociar el archivo siempre exige acceso vigente.
Las URLs públicas de archivos publicados pueden ser descargadas sin credenciales.

## Verificación reproducible

```sh
npm test
npm run build:staging
npm run verify:test-new-endpoints
node scripts/verify-owner-access.mjs
```

Las pruebas reales rechazan cualquier proyecto distinto de `vvn-pruebas`, usan
dos operadores, crean datos sintéticos propios y los retiran al terminar. La
prueba HTTP cubre también Descubre, atribución de campañas, QR, revocación,
conflictos, reintentos, todas las secciones y archivos reales en Storage.
Los resultados locales se guardan en `.test-results/`, fuera de Git.

Verificación de esta entrega: 177 pruebas unitarias, compilación de staging,
580 comprobaciones HTTP/persistencia de los endpoints nuevos y 35 comprobaciones
directas de RPC/Storage aprobadas. Los fixtures y archivos de estas dos suites
se eliminan al terminar. El CDN desplegado y la UI de las apps quedan fuera de
estas pruebas. No se aplicaron migraciones ni despliegues de producción.
