# Prompt de arranque — API `/api/v1/*` para las apps de Vive Valle Norte

> Copia todo lo que está debajo de la línea y pégalo en una sesión nueva de Claude Code,
> abierta **en este repo** (`ClickLocalWebApp`).
> Va antes o en paralelo al prompt de las apps (`specs/prompt-scaffold-mobile.md`).

---

# Objetivo

Construye la **API pública versionada que van a consumir las apps nativas de Vive Valle
Norte** (iOS y Android), dentro de este mismo proyecto Next.js, bajo `src/app/api/v1/`.

Cubre **todos los flujos de VVN de cara al vecino**. **Excluye por completo el admin**: nada
de CRUD, nada de `/admin`, nada de CRM, cobranza, recibos, leads, analytics de dashboard,
blog authoring ni webhooks de bots. Esta API es de **consumo público**, igual que lo que hoy
sirve el sitio.

---

# Contexto que debes leer antes de escribir código

Este repo sirve dos marcas desde un mismo deployment: **ClickLocal** (directorio geo general)
y **Vive Valle Norte** (directorio por plaza en fraccionamientos del norte de Zapopan). La
frontera entre ambas es un filtro, no una tabla aparte:

```
ClickLocal general  =  venues.fraccionamiento_id IS NULL
Vive Valle Norte    =  venues.fraccionamiento_id IS NOT NULL
```

A eso se le llama "la pared" en el código. **Esta API es solo del lado VVN.**

| Archivo | Para qué |
|---|---|
| `AGENTS.md` | ⚠️ Next 16 tiene cambios de ruptura. Lee `node_modules/next/dist/docs/` antes de usar cualquier API que no hayas verificado |
| `CLAUDE.md` | Reglas de producto; bitácora (lee la entrada del 2026-10-13 sobre el consumo de Vercel) |
| `specs/SPEC.md` secciones 4, 17, 20, 22 | Modelo de datos, módulo VVN, rutas de API, caché |
| `src/types/index.ts` | **La forma exacta de los DTOs** |
| `src/services/venues.ts` | Mappers, la pared, orden de queries, `isFichaLocked` |
| `src/services/fraccionamientos.ts`, `promotions.ts`, `blog.ts`, `blog-venues.ts`, `vvn-announcements.ts`, `zone-promotions-server.ts`, `venue-detail-server.ts` | Las lecturas que hay que exponer |
| `src/app/api/venues/stats/route.ts`, `venues/rating/route.ts`, `track/route.ts`, `vvn/stats/route.ts`, `promotions/stats/route.ts` | Las escrituras existentes y su patrón |
| `src/lib/rate-limit.ts`, `src/lib/visitor-id.ts`, `src/lib/track.ts`, `src/lib/track-server.ts` | Limitador, identidad anónima, catálogo de eventos |
| `supabase/schema.sql` y `supabase/migrations/` | RLS, GRANTs y RPCs |

---

# Restricciones duras

**1. El costo de Vercel manda.** En octubre Vercel pausó este proyecto por rebasar límites, y
la causa fue renderizar de más. Toda ruta de lectura nace con cabeceras de CDN **en el primer
commit**, no "después":

```
Cache-Control: public, s-maxage=300, stale-while-revalidate=600
```

(60 s para blog). Un hit de CDN no invoca función. Si una ruta no puede cachearse, justifica
por qué en un comentario.

**2. Nada personalizado puede cachearse en el CDN.** La única respuesta personalizada es el
GET de calificación (trae el voto del visitante). Esa va con `Cache-Control: private, no-store`.
Servir desde CDN una respuesta que depende de `X-Visitor-Id` significa enseñarle a todos el
voto de uno. No lo hagas.

**3. La pared se aplica en el servidor, siempre.** Ningún endpoint de esta API devuelve
negocios con `fraccionamiento_id IS NULL`.

**4. Aditivo.** No cambies el comportamiento de la web. No toques `src/proxy.ts`. No rompas
ninguna ruta existente. Los tipos de `src/types/index.ts` se reusan, no se reescriben.

**5. Sin claves ni secretos en el cliente.** La API es pública de lectura, igual que el sitio.
**No inventes un API key**: se extrae del binario en diez minutos y da seguridad falsa. El
control de abuso es el limitador por IP más el CDN.

**6. Sin CORS.** Una app nativa no lo necesita. No abras cabeceras de CORS "por si acaso".

**7. El service role nunca sale del servidor.** Varios servicios de lectura usan hoy
`createSupabaseAdmin()` por comodidad aunque sus datos sean públicos por RLS. Está bien
reusarlos desde el route (es servidor), pero no introduzcas ningún camino nuevo en que la
clave llegue a una respuesta.

---

# Diseño del contrato

## Base y versión

Base: `https://vivevallenorte.com/api/v1`. Cada respuesta lleva `X-Api-Version`.
No hay lógica por host: esta API es solo VVN, se sirva desde el dominio que se sirva.

## Forma de los datos

Los JSON **espejean exactamente los tipos de `src/types/index.ts`**: objetos anidados
(`contact.phone`, `location.lat`, `media.logo_url`, `daily_update.text`, `stats.views`), no las
filas planas de Postgres. Reusa los mappers que ya existen (`rowToVenue`, `rowToPlaza`,
`rowToParque`, `rowToPromotion`, …). Así el cliente móvil deserializa y ya; cero capa de
traducción.

## Qué calcula el servidor y qué calcula el cliente

| Campo | Dónde | Por qué |
|---|---|---|
| `is_pro` | **Servidor** | Resuelve en un solo lugar la regla de capado; cambiarla no exige publicar una app |
| `has_promo` | **Servidor** | Requiere una query extra que el cliente no puede hacer barato |
| `rating_sum` / `rating_count` crudos | Servidor | El umbral de 3 votos lo aplica el cliente |
| **Estado abierto/cerrado** | **Cliente** | ⚠️ No lo mandes calculado. Con 300 s de caché llegaría viejo y contradiría al reloj del teléfono. Manda `status`, `opening_hours`, `status_override` y `status_override_until` crudos, y que la app lo recalcule cada minuto |
| Vigencia de promoción, frescura del día, orden, búsqueda | Cliente | Son funciones puras sobre datos que ya van en la respuesta |

**Antes de implementar `is_pro`, pregúntame cuál es la regla canónica.** Hoy el código tiene
dos y divergen:

- `VenueDetail.tsx:774` → `isPro = !isVvn || is_premium` (capa a cualquier negocio VVN no
  premium, incluidos los sueltos tipo Oxxo que no están en una plaza)
- `services/venues.ts:96` → `isFichaLocked = plaza_id != null && !is_premium` (capa solo
  locales de plaza)

Elige una, déjala en una sola función exportada, haz que la web **y** la API la usen, y
documenta el cambio.

## Envoltura de respuesta y errores

Conserva el estilo que ya usan las rutas de este repo:

```jsonc
// éxito
{ "ok": true, "data": { … } }
// error
{ "ok": false, "error": "invalid", "message": "texto para humanos, opcional" }
```

Códigos: 400 `invalid` / `invalid_stars` / `invalid_event`, 404 `not_found`,
429 `rate_limited` / `daily_limit` (con `X-RateLimit-*` y `Retry-After`), 500 con error genérico.
**Nunca filtres mensajes crudos de Postgres al cliente**; regístralos con Sentry y devuelve algo
genérico.

## Ahorro de datos

Todas las lecturas emiten `ETag` y responden **304** ante `If-None-Match`. En un pull-to-refresh
con red mala, eso es la diferencia entre 80 KB y nada.

## Paginación

`?limit=` (default 50, máximo 100) y `?cursor=` en las listas que pueden crecer: feed del día,
blog y cupones. Las demás devuelven el conjunto completo con un tope duro.

Mantén el set de parámetros **corto y enumerable**: cada combinación nueva es una entrada de
caché más y una vía para esquivar el CDN.

---

# Endpoints de lectura

Deriva cada uno de los servicios que ya existen; no escribas queries nuevas si hay una función
que ya hace el trabajo.

### `GET /api/v1/config`
Lo que debe poder cambiar sin publicar una versión de la app:
versión mínima soportada por plataforma, bandera de apagado con mensaje, fraccionamiento por
default, WhatsApp del admin (`NEXT_PUBLIC_ADMIN_WHATSAPP`), correo de contacto, y los datos del
plan Pro (precio, precio tachado, lista de beneficios — hoy están hardcodeados en
`src/app/planes/page.tsx`). Caché corta: 60 s.

### `GET /api/v1/fraccionamientos`
Lista para el onboarding y el selector. Fuente: `getFraccionamientos()`.

### `GET /api/v1/fraccionamientos/{slug}`
El payload del home de la pestaña Explorar, en **una sola llamada**: el fraccionamiento, sus
plazas, sus parques, sus negocios (`getVenuesByFraccionamiento`, que ya ordena por
`is_deprioritized` → `is_featured` → `status` → `name`), los avisos de la casa activos, y el
conjunto de ids con promoción vigente (`getVenueIdsWithLivePromotions`) proyectado como
`has_promo` en cada negocio. Incluye los conteos ("N locales · N plazas · N parques").
404 si el slug no existe. Reusa `loadFraccData` de
`src/app/vvn/[fraccionamiento]/fraccionamiento-view.tsx` como referencia.

### `GET /api/v1/plazas/{id}`
Plaza + sus locales (`getVenuesByPlaza`, mismo orden) con `has_promo` e `is_pro`. Incluye
`amenities`, `zona`, `cover_url`, `description` y las coordenadas del pin.

### `GET /api/v1/parques/{id}`
Parque con descripción, `amenities`, `photos`, `cover_url` y coordenadas.

### `GET /api/v1/venues/{id}`
La ficha completa. Reusa `getVenueDetailData` (`src/services/venue-detail-server.ts`): venue +
`menu_items` + `services` + promociones vigentes + `venue_photos` (máx. 10) + la tarjeta de su
plaza. Agrega `is_pro`. 404 si no existe o `is_active = false`.
**Solo acepta UUID**, no slug.

### `GET /api/v1/venues/resolve?path={slug}`
Traduce el slug de una URL web a un id, para que un deep link
`vivevallenorte.com/venue/panaderia-la-espiga` abra la ficha correcta.
⚠️ `resolveVenueByPath` (`src/app/venue/[id]/resolve-venue.ts`) hoy lee **todos** los venues
activos y hace el match en JS — es O(n) y está documentado como deuda. Aprovecha y arréglalo
de raíz: migración aditiva que agregue una columna `slug` indexada en `venues`, con backfill
y mantenimiento al guardar. Si decides no hacerlo ahora, dilo y deja el camino caro detrás de
una caché agresiva.

### `GET /api/v1/feed`
Las actualizaciones del día de toda la zona. Fuente: `getVvnFeedVenues()` (negocios VVN con
`daily_text` o `daily_image_url` y `daily_updated_at` de menos de 24 h, ordenados por fecha
descendente). Más los avisos activos de `vvn_announcements`.
⚠️ En esa tabla la columna se llama **`body`** y el tipo TypeScript la expone como `text`:
respeta el nombre del tipo en el JSON.

### `GET /api/v1/cupones`
Ofertas y cupones vigentes de la zona, agrupados por negocio. Fuente:
`getZonePromotionsByVenue()`. Dentro de cada grupo, ofertas antes que cupones. Es la pestaña
Cupones de la app y la superficie que paga el negocio Pro: devuelve lo necesario para pintar la
tarjeta completa (`kind`, `title`, `description`, `discount_label`, `code`, `image_url`,
`terms`, `starts_at`, `ends_at`) más la identidad del negocio (nombre, logo, href).
Acepta `?fraccionamiento={slug}` para filtrar.

### `GET /api/v1/blog` y `GET /api/v1/blog/{slug}`
Posts publicados. ⚠️ La RLS de `blog_posts` solo filtra `is_active`; **la condición
`published_at <= now()` la aplica la aplicación**, así que el endpoint tiene que aplicarla
también o publicarás borradores. Acepta `?cat=` con `guia | evento | anuncio | noticia`.

En el detalle, incluye las **tarjetas de negocio referenciadas en el cuerpo**: el cuerpo trae
líneas `@venue:slug | descripción` que `getBlogVenueCards` resuelve. Mándalas resueltas en el
payload (`venue_cards`) para que la app no tenga que hacer N llamadas al renderizar el post.
Caché 60 s.

### Contenido estático
FAQ, Acerca, Contacto, Privacidad y Términos **no** necesitan endpoint: son texto que cambia
una vez al año y debe verse sin red. Van compilados en la app. Lo que sí sale de
`/api/v1/config` son los datos que cambian: WhatsApp, correo y precios del plan.

---

# Endpoints de escritura

Las escrituras **no se pueden hacer desde el cliente con la anon key** y hay que entender por
qué, porque determina el diseño:

- `analytics_events` tiene RLS activo **sin ninguna política** y los `INSERT` están revocados
  para `anon`.
- `venue_ratings` tiene `REVOKE SELECT` e `INSERT` para `anon`: ni leer el voto propio ni votar
  se puede directo.
- Los RPC `increment_promotion_views` / `increment_promotion_taps` son los **únicos** que no
  están concedidos a `anon`.

Por eso todo lo que escribe pasa por estas rutas, que además aplican limitador y hacen el
*dual-write* (contador + evento en `analytics_events`).

## No dupliques la lógica existente

Las rutas de escritura ya existen y funcionan. **Extrae el cuerpo de cada una a una función
compartida** (sugerencia: `src/server/stats/*.ts`) y haz que **tanto la ruta web actual como
la nueva ruta `/api/v1/`** la llamen. Una implementación, dos superficies. No copies y pegues:
el doble conteo de `rating_submit` de octubre nació justo de tener la misma lógica en dos
lados.

| Nueva ruta | Reusa | Notas |
|---|---|---|
| `POST /api/v1/stats/venue` | `api/venues/stats` | `{ venueId, kind: "view"\|"whatsapp"\|"website" }` |
| `POST /api/v1/stats/vvn` | `api/vvn/stats` | `{ id, kind: "plaza"\|"parque" }` |
| `POST /api/v1/stats/promotions` | `api/promotions/stats` | lote de ids + `kind: "view"\|"tap"` |
| `GET /api/v1/ratings?venueId=` | `api/venues/rating` GET | `private, no-store` |
| `POST /api/v1/ratings` | `api/venues/rating` POST | |
| `POST /api/v1/track` | `api/track` | |
| `POST /api/v1/devices` | — nuevo | registro del token de push |

## Tres cambios obligatorios

**1. Identidad de visitante sin cookie.** `getOrCreateVisitorId()` (`src/lib/visitor-id.ts`) hoy
depende de la cookie httpOnly `clicklocal_vid`, que una app nativa no tiene. Debe aceptar una
cabecera **`X-Visitor-Id`** como alternativa, con el mismo formato que valida hoy
(`/^[0-9a-f-]{16,64}$/i`). La app genera un UUID al primer arranque y lo guarda en Keychain /
DataStore cifrado.

Es falsificable, sí — pero borrar una cookie también lo es. El freno real sigue siendo el tope
de **10 votos nuevos por IP y día**, que no cambia. Conserva los tres frenos superpuestos:
limitador por IP (5/min en `rating-submit`), dedupe por visitante, y tope por IP+día. Y conserva
la pared: un negocio sin `fraccionamiento_id` responde `not_rateable`.

**2. El tope del lote de promociones.** `MAX_PROMOS_PER_REQUEST = 24` **trunca en silencio**
(`valid.slice(0, 24)`). Una pestaña entera de cupones lo rebasa y se perderían vistas sin que
nadie se entere. Sube el tope o documenta en el contrato que el cliente debe paginar el lote —
y en cualquier caso, **registra cuando se trunque**.

**3. Eventos móviles en la lista blanca.** `TRACK_EVENTS` (`src/lib/track.ts`) es una whitelist
estricta y `/api/track` rechaza lo que no esté. Agrega: `app_open`, `push_received`,
`push_open`, `coupon_save`, `tab_select`, `notif_optin`. Agrega también `platform`
(`"ios" | "android" | "web"`) al `meta`.

⚠️ **Regla que no se rompe:** los eventos con contraparte en columna (`venue_view`,
`venue_whatsapp`, `venue_website`, `plaza_view`, `parque_view`, `promo_view`, `promo_copy`,
`rating_submit`) se escriben **solo desde el servidor**, dentro del dual-write. La app no debe
poder emitirlos por `/track`: recházalos ahí explícitamente, o contarán doble.

## `POST /api/v1/devices`

Registro y renovación del token de push. Migración aditiva nueva: tabla `device_tokens` con
`token` (único), `platform`, `fraccionamiento_slug`, `topics`, `app_version`, `visitor_key`,
`created_at`, `last_seen_at`. **RLS activo sin políticas** (solo service role), igual que
`analytics_events` y `venue_ratings`.

Body: `{ token, platform, fraccionamientoSlug, topics[], appVersion }`. Upsert por `token`,
actualizando `last_seen_at`. Limitador propio, generoso (la app lo llama al arrancar y cuando
FCM rota el token). Un token es un identificador de dispositivo: no lo registres en logs ni
en Sentry.

*El envío de las notificaciones es trabajo de admin y queda fuera de esta tarea.*

---

# Fuera de alcance

Nada de admin, CRM, cobranza, recibos, leads, analytics de dashboard, autoría de blog, subida
de medios ni webhooks de bots. Nada de ClickLocal general, Ocasión ni publicidad recomendada.
Ningún endpoint de escritura que modifique un negocio: el dueño edita por Telegram y eso no
cambia. Nada de autenticación de usuarios.

---

# Entregables

1. Las rutas bajo `src/app/api/v1/`.
2. Los helpers compartidos de escritura en `src/server/`, con las rutas web actuales ya
   apuntando a ellos.
3. La migración de `device_tokens` en `supabase/migrations/` (y la de `venues.slug` si decides
   hacerla).
4. Los cambios en `src/lib/visitor-id.ts` y `src/lib/track.ts`.
5. **`specs/MOBILE-API.md`**: el contrato completo — cada endpoint con su método, parámetros,
   forma exacta de respuesta, cabeceras de caché, códigos de error y un ejemplo real de JSON.
   Es lo que va a leer el desarrollador móvil en vez de leerse este Next.js entero. No lo
   trates como documentación de relleno: es el entregable que desbloquea la otra mitad del
   proyecto.
6. Una entrada en la bitácora de `CLAUDE.md` siguiendo el formato que ya usa ese archivo.

---

# Verificación

1. `npm run build` y `npm run lint` limpios.
2. Un script de contrato (`scripts/check-v1-contract.ts`) que golpee cada endpoint contra un
   servidor local y valide la forma de la respuesta y el código de estado. Inclúyelo en los
   entregables.
3. **Caché, contra un build de producción** (`npm run build && npm start`, nunca en `next dev`,
   donde el caché no se puede observar): `curl -I` dos veces a cada ruta de lectura y confirmar
   que la segunda sirve de caché. Y confirmar que `GET /api/v1/ratings` responde `no-store`.
4. **Paridad con la web**: para tres negocios reales, comparar el JSON de
   `/api/v1/venues/{id}` contra lo que pinta `/venue/{slug}` — mismas secciones, mismo
   `is_pro`, mismas promociones vigentes.
5. **La pared**: verificar que ningún endpoint devuelve un negocio con
   `fraccionamiento_id = null`. Incluye una prueba explícita.
6. Correr los agentes propios de este repo sobre el diff: **`auditor-vercel`** (consumo) y
   **`guardian-vvn`** (que la pared y el gating sigan intactos).
7. Verificar que el sitio web sigue funcionando igual: home de fraccionamiento, ficha de
   negocio, calificar, cupones y blog.

---

# Cómo trabajar

- Lee `node_modules/next/dist/docs/` antes de usar cualquier API de Next 16 que no hayas
  verificado en esta sesión. Esta versión tiene cambios de ruptura respecto de lo que
  probablemente recuerdas, sobre todo en caché, route handlers y `proxy`.
- Trabaja en una rama (`feat/api-v1-mobile`) y no hagas push ni abras PR sin que yo lo pida.
- Si una decisión de producto no está aquí ni en el repo, **pregúntame** en vez de elegir
  por mí. En particular: la regla canónica de `is_pro`, y si quieres que agregue la columna
  `slug` ahora.
- Avísame al terminar las lecturas, antes de empezar con las escrituras.
