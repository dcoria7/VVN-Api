# Descubre: destacados y patrocinados

## Estado

Implementación local de VVN-API. Migración aplicada y verificada en `vvn-pruebas`.
En este chat no se desplegó ni se confirmó la publicación de esta ampliación en
producción. El panel está implementado localmente en la web
(`/admin/destacados` y `/admin/patrocinados`); iOS/Android todavía no se han
conectado a esta ruta. Los registros quedan vacíos y los nuevos
registros se crean desactivados de forma predeterminada.

## Endpoint público

`GET /api/v1/descubre`

- `fraccionamiento`: slug opcional; omitirlo consulta toda la zona. Con filtro,
  patrocinados globales (`fraccionamiento_id IS NULL`) también son elegibles.
- `limit`: 6 de forma predeterminada, máximo 20 por swimlane.
- `featured_cursor`, `sponsored_cursor`: paginación independiente, con los cursores
  opacos que devuelve cada sección. Tope de lectura de 200 selecciones/campañas.
- Orden: `position`, `created_at`, `id`, todos ascendentes.
- Solo contenido activo, con `starts_at <= now` y `ends_at > now` o sin fin.
- Destacados y destinos de tipo venue solo incluyen negocios activos de la marca
  del despliegue, pertenecientes a un fraccionamiento.

Respuesta sin contenido configurado:

```json
{
  "ok": true,
  "data": {
    "featured_venues": { "visible": false, "items": [], "next_cursor": null, "total": 0 },
    "sponsored": { "visible": false, "items": [], "next_cursor": null, "total": 0 },
    "plazas": []
  }
}
```

**Regla de renderizado:** si `visible` es false, omitir TODO el swimlane: no pintar
encabezado, placeholder, card vacía ni espacio reservado. Esta regla es una
excepción a los estados vacíos de otras secciones de Descubre. Cada sección se
oculta independientemente de la otra.

`featured_venues.items[]`:

- `placement_id`: UUID de la selección editorial (para atribuir métricas).
- `starts_at`, `ends_at`: vigencia; fin exclusivo.
- `venue`: DTO público idéntico al del directorio, con `is_pro` y `has_promo`.
- `plazas[]` en `data`: `{id,name}` de las plazas de la página; permite reutilizar
  la card del directorio sin depender de haber abierto Explorar.

`sponsored.items[]`:

- `id`, `title`, `image_url`, `cta_label`, `starts_at`, `ends_at`.
- `label`: siempre **Patrocinado**; no confundirlo con un destacado editorial.
- `kind`: `venue`, `property_sale`, `property_rent`, `survey` u `other`.
- `target`: `{type:"venue",venue_id,web_path}` o `{type:"url",url}`.
- Imágenes y destinos externos deben ser HTTPS y no contener credenciales.

El endpoint no escribe métricas. Respuestas públicas con ETag/304 y caché CDN de
hasta 60 s, reducida hasta el próximo vencimiento de una card de la página, sin
stale posterior. Los clientes deben retirar cards al vencer aunque conserven el
payload en memoria. Activar o reordenar contenido puede tardar hasta 60 s en verse.
Los errores de consulta son 500, privados y no cacheables; no son listas vacías.

## Administración y persistencia

- `vvn_featured_venues`: `brand_id`, `venue_id`, `position`, `is_active`,
  `starts_at`, `ends_at`. Una selección por negocio y marca; no depende de
  `venues.is_featured` ni altera el orden del directorio.
- `vvn_sponsored_campaigns`: `brand_id`, título, imagen, tipo, CTA, destino,
  fraccionamiento opcional, orden, activación y vigencia.
- Ambas tablas llevan `id`, `created_at`, `updated_at`, RLS por operador/marca,
  validación de referencias de la misma marca y marca inmutable.
- El público no tiene acceso directo a las tablas. La API usa su operador de
  servidor. La UI del admin debe autenticar y autorizar al administrador
  antes de escribir con su cliente de servidor. No agregar CRUD público a esta ruta.
- Migración: `supabase/migrations/20261127041147_discover_swimlanes.sql`.
  Requiere el esquema central `directory_brands` ya aplicado. Aplicarla en el
  proceso de despliegue de la base central antes de desplegar esta ruta en prod.

## Medición por POST /api/v1/track

Destacados:

```json
{
  "event": "featured_impression",
  "entityType": "venue",
  "entityId": "UUID_DEL_NEGOCIO",
  "platform": "ios",
  "meta": { "placement_id": "UUID_DE_LA_SELECCION" }
}
```

Usar `featured_open` al abrir la ficha desde esa card. La apertura normal de la
ficha continúa registrándose por `/stats/venue`; `featured_open` solo atribuye el
origen y no incrementa dos veces las vistas del negocio.

Patrocinados, incluido contenido que no es un venue:

```json
{
  "event": "sponsored_click",
  "platform": "android",
  "meta": { "campaign_id": "UUID_DE_LA_CAMPAÑA" }
}
```

Usar `sponsored_impression` cuando la card se haga visible. No enviar `entityId`
ni `entityType` en estos eventos: la atribución está en `meta.campaign_id` y no se
finge que un inmueble o encuesta sea un venue. Esto conserva compatibilidad con
el trigger central de `analytics_events` y permite agrupar métricas por campaña.
El servidor valida que selección/campaña exista, pertenezca a la marca y esté
vigente. En destacados verifica también que el venue corresponda a esa selección.

Las impresiones se emiten al ser visible la card, nunca por recibir el JSON. La
app debe evitar repetirlas por recomposición durante la misma visita; el endpoint
no deduplica reintentos ni impide fraude de analítica. `platform` acepta `ios`,
`android` o `web`. La atribución se conserva dentro del límite de ocho claves de
`meta`, incluida la plataforma.

## Verificación

- Pruebas unitarias de listas, vigencia, destinos, aislamiento de marca, errores,
  DTO público, filtros, paginación independiente, ETag y eventos de medición.
- Migración aplicada en staging; comprobaciones reales de RLS, referencias entre
  marcas, restricciones de URL, marca inmutable, eventos y denegación a anon.
- Las comprobaciones reales usan una transacción y hacen rollback: no dejan
  selecciones, campañas ni eventos sintéticos publicados.

Validación de esta iteración: 161 pruebas unitarias, compilación local de Next,
144 comprobaciones de contrato HTTP, 43 peticiones de aislamiento y 58 de fallas/
recuperación. Además, HTTP real contra `vvn-pruebas`: listas sin configuración
ocultas, cabecera de staging, ETag/304 y rechazo de campaña inexistente sin
insertar métricas. Sin avisos de seguridad nuevos sobre las dos tablas.

La raíz canónica `../ClickLocalWebApp` conserva ahora la misma migración en su
cadena activa y documenta el panel en `docs/descubre-admin.md`. No aplicar las
copias de ambos proyectos dos veces en el mismo entorno.

Cierre de la iteración: [ITERATIONS.md](ITERATIONS.md). Antes de integrar en apps,
confirmar el despliegue de este endpoint y la migración en el entorno de destino.
