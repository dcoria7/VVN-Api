# API móvil de Vive Valle Norte — `/api/v1`

Contrato de la API pública que consumen las apps nativas (iOS y Android). Esto es
lo que necesitas leer para escribir el cliente; no hace falta leer el Next.js.

**Base de producción:** `https://api.vivevallenorte.com/api/v1`.
Desarrollo/staging local: `http://127.0.0.1:3123/api/v1`. Las ampliaciones de
Descubre y propietarios están verificadas en staging; su disponibilidad en
producción requiere desplegar el código y aplicar sus migraciones.

Todo lo de aquí es **solo Vive Valle Norte**. ClickLocal general, Ocasión y la
publicidad recomendada no salen por esta API, y tampoco nada del admin.

La marca se fija en el servidor mediante `VVN_BRAND_ID`, verificada con el operador
de VVN. La app no envía marca: headers, query params y campos extra de marca no
cambian el ámbito. Las búsquedas por slug están limitadas a VVN aunque otra marca
use el mismo slug. IDs ajenos en lecturas/calificaciones/estadísticas dan 404;
en `/track`, referencias ajenas o tipos de entidad no admitidos dan `400 invalid`.

---

## Índice

- [Reglas generales](#reglas-generales)
- [Caché y ahorro de datos](#caché-y-ahorro-de-datos)
- [Qué calcula el servidor y qué calculas tú](#qué-calcula-el-servidor-y-qué-calculas-tú)
- [Errores](#errores)
- [Paginación](#paginación)
- [Identidad del visitante](#identidad-del-visitante)
- **Lectura:** [config](#get-config) · [fraccionamientos](#get-fraccionamientos) ·
  [fraccionamiento](#get-fraccionamientosslug) · [plaza](#get-plazasid) ·
  [parque](#get-parquesid) · [negocio](#get-venuesid) · [resolve](#get-venuesresolve) ·
  [feed](#get-feed) · [cupones](#get-cupones) · [blog](#get-blog) · [post](#get-blogslug)
- **Escritura:** [stats/venue](#post-statsvenue) · [stats/vvn](#post-statsvvn) ·
  [stats/promotions](#post-statspromotions) · [ratings](#get-ratings) ·
  [track](#post-track) · [devices](#post-devices)
- [El tipo Venue](#el-tipo-venue)
- [Descubre y atribución](DISCOVER.md)
- [Acceso privado de propietarios y archivos](OWNER-API.md)
- [Contenido que va compilado en la app](#contenido-que-va-compilado-en-la-app)
- [Cómo verificar](#cómo-verificar)

---

## Reglas generales

**No hay API key y no la pidas.** Una clave embebida en un binario se extrae en
diez minutos, así que daría seguridad falsa a cambio de trabajo real. El control
de abuso es el limitador por IP más el CDN. La API es pública de lectura, igual
que el sitio web.

**No hay CORS.** Una app nativa no lo necesita y abrirlo "por si acaso" solo
agregaría superficie.

**Las lecturas públicas no requieren cuenta.** El acceso privado de propietarios
es una excepción: `/owner` y `/owner/media` usan secretos de sesión e instalación
vinculados mediante QR. Ver [su contrato](OWNER-API.md). Las credenciales de
Supabase permanecen en el servidor.

Toda respuesta lleva `X-Api-Version: 1`.

**Envoltura:**

```jsonc
// éxito
{ "ok": true, "data": { /* … */ } }

// error
{ "ok": false, "error": "not_found", "message": "texto para humanos, opcional" }
```

Los objetos van **anidados** como en el modelo del dominio (`contact.phone`,
`location.lat`, `media.logo_url`, `daily_update.text`, `stats.views`), no planos
como las filas de Postgres. Deserializa y usa; no hace falta capa de traducción.

---

## Caché y ahorro de datos

Cada lectura trae su política de caché. Respétala: el proyecto se pasó de los
límites de Vercel en octubre de 2026 por renderizar de más, y estas cabeceras son
lo que evita que vuelva a pasar.

| Grupo | `Cache-Control` |
|---|---|
| Lecturas normales | `public, s-maxage=300, stale-while-revalidate=600` |
| `/config`, `/blog`, `/blog/{slug}` | `public, s-maxage=60, stale-while-revalidate=300` |
| Escrituras y `GET /ratings` | `private, no-store` |
| 404 de lectura pública | `public, s-maxage=10, stale-while-revalidate=10` |
| Errores 500 y `/config` degradado | `private, no-store` |

**ETag y 304.** Las lecturas públicas correctas emiten `ETag`. Guárdalo y mándalo en
`If-None-Match` al refrescar: si no cambió nada recibes **304** sin cuerpo. En el
home de un fraccionamiento eso es la diferencia entre ~110 KB y cero — importa en
un pull-to-refresh con mala señal. El 304 repite el `Cache-Control`, así que no
pierdes la política al revalidar.

**`GET /ratings` nunca se cachea.** Es la única respuesta personalizada de toda la
API (trae el voto de *este* visitante). Si alguna vez la ves con `s-maxage`, es un
bug: repórtalo, no lo cachees tú.

### Cuánto tarda en llegar un cambio

Hay dos capas de caché apiladas: la de datos del servidor (300 s) y la del CDN
(300 s + 600 s sirviendo stale mientras revalida). Un cambio que haga el dueño por
bot o el admin en el panel puede tardar **hasta ~15 minutos** en verse en la app.
No lo trates como tiempo real.

Lo que **no** sufre ese retraso es el horario: `opening_hours` cambia muy poco y
el estado abierto/cerrado lo calculas tú con el reloj del teléfono, así que un
negocio que cruza su horario cambia al instante en pantalla. Lo que sí llega con
retraso es el **override manual** del dueño (`status_override`, el "abierto"/
"cerrado" que manda por bot fuera de horario) y el post del día.

Un 404 de lectura pública tiene 10 s en CDN y 10 s adicionales de
`stale-while-revalidate`. Las ausencias no se guardan en la caché interna de
datos de 300 s. Las fallas de consultas tampoco se guardan como ausencias o
payloads parciales. Una respuesta correcta previamente cacheada puede seguir
sirviéndose durante su ventana de frescura/revalidación.

---

## Qué calcula el servidor y qué calculas tú

| Dato | Quién | Por qué |
|---|---|---|
| `is_pro` | **Servidor** | La regla de capado vive en un solo lugar; cambiarla no exige publicar una app |
| `has_promo` | **Servidor** | Necesita una query extra que el cliente no puede hacer barato |
| `rating_sum` / `rating_count` | Servidor (crudos) | **El umbral lo aplicas tú**: no muestres el promedio con menos de **3** votos |
| **Abierto / cerrado** | **TÚ** | Ver abajo |
| Vigencia de una promoción | Tú | `starts_at <= ahora < ends_at`, con `null` = sin límite |
| Frescura del post del día | Servidor | `daily_update` llega `null` si caducó (>24 h); no la recalcules |
| Orden de las listas | Servidor | Ya vienen ordenadas; no reordenes salvo que el usuario lo pida |
| Búsqueda y filtros | Tú | Sobre los datos que ya tienes |

### El estado abierto/cerrado lo calculas tú

El servidor **no** manda "abierto" o "cerrado" calculado, a propósito: con 300 s
de caché llegaría viejo y contradiría al reloj del teléfono. Te manda los datos
crudos y tú recalculas, idealmente cada minuto:

- `opening_hours`: arreglo de 7 días, **índice 0 = lunes … 6 = domingo**, cada uno
  `{ closed, open: "HH:mm", close: "HH:mm" }`. **Siempre en hora de Guadalajara
  (`America/Mexico_City`)**, no en la del dispositivo. Si `close <= open`, el rango
  cruza la medianoche (abre 18:00, cierra 02:00 del día siguiente).
  Un día también puede incluir `intervals:[{open,close},…]` (de uno a tres turnos).
  Si existe, calcular la apertura sobre esos intervalos; usar `open`/`close` como
  respaldo cuando `intervals` no esté presente. Conservar el spillover del día
  anterior para cualquier intervalo que cruce medianoche.
- `status`: el estado manual. **Es el valor efectivo solo si `opening_hours` es
  `null`** (negocios sin horario configurado, que el dueño prende y apaga por bot).
- `status_override` + `status_override_until`: override temporal del dueño. Mientras
  `status_override_until` esté en el futuro, **manda sobre el horario**.

El algoritmo, en orden:

1. Si `status_override_until` está en el futuro → `status_override`.
2. Si no, y hay `opening_hours` → calcularlo con la hora de Guadalajara.
3. Si no → `status`.

La referencia es `src/lib/venue-hours.ts` (`getEffectiveStatus`). Si cambias algo
de esta lógica, cámbialo ahí también.

---

## Identidad del ambiente

Hay dos ambientes: `staging` y `production`. Cada app fija su URL al compilar y
exige `X-Vvn-Environment` coincidente en la respuesta. `/config` también devuelve
`environment`. Las cabeceras del cliente no seleccionan el ambiente del servidor.
Staging se prueba localmente contra `vvn-pruebas`; ambas URLs públicas siguen
pendientes. Ver `specs/ENVIRONMENTS.md`.

## Errores

| Código HTTP | `error` | Cuándo |
|---|---|---|
| 400 | `invalid` | Falta un parámetro o tiene mala forma (UUID, slug, `kind`) |
| 400 | `invalid_body` | El body no es un objeto JSON |
| 400 | `invalid_event` | Evento de `/track` fuera de la whitelist, o de los que solo escribe el servidor |
| 400 | `invalid_stars` | Estrellas fuera de 1–5 |
| 400 | `not_rateable` | El negocio no es de VVN (no se califica) |
| 404 | `not_found` | No existe, está inactivo, **o es de ClickLocal general** |
| 429 | `rate_limited` | Pasaste el limitador. Mira `Retry-After` |
| 429 | `daily_limit` | Tope de calificaciones nuevas por IP y día |
| 405 | — | Método no soportado en esa ruta |
| 500 | `server_error` | Fallo nuestro. Ya está en Sentry; reintenta con backoff |

Los 429 traen `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` y
`Retry-After` (segundos). **Respeta `Retry-After`**; no reintentes en bucle.

Un 500 **nunca** trae el mensaje crudo de Postgres: el detalle va a Sentry y tú
recibes un código genérico. No parsees el `message` para decidir lógica.

Si falla una consulta necesaria para construir una respuesta, se devuelve
`500 server_error` con `private, no-store`, sin ETag ni datos parciales. El 404
queda reservado para ausencia real dentro del catálogo autorizado. Una colección
vacía leída correctamente conserva su respuesta 200.

Las escrituras de estadísticas requieren el RPC atómico; un RPC fallido no usa
un incremento alternativo ni se confirma como exitoso. Los lotes de promociones
ejecutan un RPC por ID y no forman una transacción: un 500 puede llegar después
de que algunos incrementos hayan terminado. No reintentes automáticamente esos
lotes, ya que todavía no tienen claves de idempotencia. La analítica secundaria
se reporta si falla y no invalida un contador o voto ya confirmado.

**Límites por IP:** 30/min en stats y track, 5/min al enviar una calificación,
30/min en el registro de dispositivo.

---

## Paginación

En `/feed`, `/cupones` y `/blog`:

- `?limit=` — default **50**, máximo **100**.
- `?cursor=` — cadena opaca. **No la interpretes ni la construyas**: úsala tal como
  viene en `next_cursor`. Nada valida que sea un cursor que te dimos, así que uno
  inventado simplemente se salta contenido sin avisar.
- `next_cursor` es `null` en la última página.
- `total` es el tamaño de la lista que el servidor tiene en mano, que ya viene
  acotada (el feed tope a 200). No es "todo lo que existe": si alguna vez hay más,
  `total` se queda corto en silencio.

El cursor es un desplazamiento dentro de la lista ordenada, no una clave estable.
Si la lista cambia entre dos páginas, un elemento puede repetirse o saltarse — para
contenido que se lee de arriba hacia abajo y cambia pocas veces al día es
aceptable, pero no lo uses como si fuera un cursor de keyset.

Mantén el set de parámetros corto: cada combinación nueva es una entrada de caché
más y una vía para esquivar el CDN.

---

## Identidad del visitante

Las calificaciones necesitan saber que eres el mismo de antes, sin cuentas y sin
cookies. Genera un **UUID v4 en el primer arranque**, guárdalo en **Keychain**
(iOS) o **DataStore cifrado / EncryptedSharedPreferences** (Android), y mándalo en
cada escritura que lo necesite:

```
X-Visitor-Id: 3f1a9b2c-4d5e-4f6a-8b7c-9d0e1f2a3b4c
```

Forma aceptada: un UUID (`8-4-4-4-12` en hex). Se normaliza a minúsculas, así que
no importa cómo lo generes, pero mándalo siempre igual.

El valor **nunca se guarda en claro** en la base: viaja hasheado con salt. No
identifica a nadie ni se liga a ninguna cuenta.

Sin esa cabecera, cada petición cuenta como un visitante nuevo: podrías votar
varias veces el mismo negocio y lo único que te frena es el tope por IP y día.
Mándala.

---

# Lectura

## `GET /config`

Lo que debe poder cambiar sin publicar una versión de la app. **Pídelo al
arrancar.** Caché 60 s — es la palanca de emergencia.

Si falla la lectura del fraccionamiento por defecto, la configuración de
emergencia sigue disponible: responde 200 con `default_fraccionamiento_slug: null`,
cabecera `X-Data-Degraded: 1` y `private, no-store`, sin ETag. Conserva el
fraccionamiento local y vuelve a consultar después; el interruptor de mantenimiento
sigue siendo válido. El servidor reporta la falla.

```jsonc
{
  "ok": true,
  "data": {
    "api_version": "1",
    "min_app_version": { "ios": "1.0.0", "android": "1.0.0" },
    "kill_switch": { "enabled": false, "message": null },
    "default_fraccionamiento_slug": "capital-norte",
    "contact": {
      "whatsapp": "523314050169",
      "email": "contacto.clicklocal@gmail.com"
    },
    "plan_pro": {
      "price_mxn": 200,
      "list_price_mxn": 250,
      "price_note": "Por lanzamiento",
      "tagline": "Ficha completa para destacar tu negocio. Cancela cuando lo decidas.",
      "features": ["Logo y foto de portada", "…"]
    },
    "plan_free": { "features": ["Ficha básica con nombre y categoría", "…"] },
    "web": { "site_url": "https://vivevallenorte.com" }
  }
}
```

- `min_app_version`: compara con tu versión; si la tuya es menor, pantalla de
  "actualiza" bloqueante.
- `kill_switch.enabled`: muestra `message` y no sigas.
- `plan_pro`: lo que pinta la pantalla de planes. **No hardcodees el precio.**
- `contact.whatsapp` puede ser `null`: esconde el CTA en ese caso.

## `GET /fraccionamientos`

Para el onboarding y el selector. Sin paginar.

```jsonc
{ "ok": true, "data": { "fraccionamientos": [
  { "id": "…", "name": "Capital Norte", "slug": "capital-norte",
    "center_lat": 20.78, "center_lng": -103.42, "default_zoom": 15,
    "created_at": "…" }
] } }
```

`center_*` y `default_zoom` pueden ser `null`: usa tu encuadre por defecto.

## `GET /fraccionamientos/{slug}`

**El home de la pestaña Explorar en una sola llamada.** Es la petición más
importante de la app.

```jsonc
{
  "ok": true,
  "data": {
    "fraccionamiento": { /* como arriba */ },
    "plazas":  [ { "id": "…", "fraccionamiento_id": "…", "name": "Plaza Altures",
                   "slug": "plaza-altures", "zona": null, "lat": 20.78, "lng": -103.42,
                   "cover_url": "https://…", "description": null,
                   "amenities": ["estacionamiento"], "created_at": "…" } ],
    "parques": [ { "id": "…", "fraccionamiento_id": "…", "name": "Parque de lago",
                   "slug": "parque-de-lago", "description": "…",
                   "lat": 20.78, "lng": -103.42, "cover_url": "https://…",
                   "photos": ["https://…"], "amenities": ["lago", "dog park"],
                   "created_at": "…" } ],
    "venues":  [ /* ApiVenue — ver "El tipo Venue" */ ],
    "announcements": [ { "id": "…", "title": "Vive Valle Norte",
                         "text": "…", "is_active": true,
                         "created_at": "…", "updated_at": "…" } ],
    "counts": { "venues": 65, "plazas": 5, "parques": 1 }
  }
}
```

**Orden de `venues`** (ya aplicado, no lo cambies): despriorizados al final
(`is_deprioritized`, las cadenas 24 h tipo Oxxo), destacados arriba
(`is_featured`), luego abiertos antes que cerrados, luego por nombre.

`counts` es para el subtítulo "65 locales · 5 plazas · 1 parques".

404 si el slug no existe.

## `GET /plazas/{id}`

Solo UUID. La plaza más sus locales (mismo orden que arriba).

```jsonc
{ "ok": true, "data": {
  "plaza": { /* como en plazas[] */ },
  "venues": [ /* ApiVenue */ ],
  "counts": { "venues": 3 }
} }
```

**Un pin por plaza.** Los locales de plaza heredan sus coordenadas y no tienen pin
propio: ubícalos adentro con `floor` y `local_number`. Los negocios sueltos del
coto (`plaza_id: null`) y los parques sí tienen pin propio.

## `GET /parques/{id}`

```jsonc
{ "ok": true, "data": { "parque": { /* como en parques[] */ } } }
```

Los parques son vitrina de zona: no tienen dueño, ni plan, ni capado.

## `GET /venues/{id}`

**Solo UUID**, no slug (para eso está `/venues/resolve`).

```jsonc
{
  "ok": true,
  "data": {
    "venue": { /* ApiVenue */ },
    "menu_items": [ { "id": "…", "venue_id": "…", "name": "Latte",
                      "description": null, "price": 55, "image_url": null,
                      "category": "Bebidas", "is_available": true,
                      "order": 0, "created_at": "…" } ],
    "services":   [ { "id": "…", "venue_id": "…", "name": "Corte",
                      "description": null, "price": 150, "duration": 30,
                      "image_url": null, "is_available": true,
                      "order": 0, "created_at": "…" } ],
    "promotions": [ /* solo las VIGENTES — ver /cupones */ ],
    "photos":     [ { "id": "…", "venue_id": "…", "url": "https://…",
                      "order": 0, "created_at": "…" } ],
    "plaza_card":  { "name": "Plaza Altures", "coverUrl": "https://…",
                     "href": "/capital-norte/plaza-altures" }
  }
}
```

- `menu_items` llega vacío salvo en negocios `food` / `both` / `product`;
  `services` solo en `service` / `both`.
- `photos`: máximo 10.
- `plaza_card` es `null` en los sueltos del coto. `href` es una ruta **web**,
  útil para compartir.
- **Si `venue.is_pro` es `false`, pinta la ficha capada.** Ver abajo.

404 si no existe, está inactivo, o es de ClickLocal general.

### La ficha capada (`is_pro: false`)

Es el mecanismo de venta: una ficha incompleta es el pitch. Con `is_pro: false`
muestra siempre **nombre, giro, plaza, local y teléfono, búsqueda y mapa** — el
directorio tiene que servirle al vecino aunque el negocio no pague — y bloquea con
candado el resto: galería, botón de WhatsApp, horario, menú con precios,
promociones, Instagram, sitio web y catálogo.

No escribas "Pronto" en los candados: ese copy es del competidor. Usa
**"Por activar"**.

Los campos bloqueados **pueden venir con datos** en la respuesta: el gate es
`is_pro`, no la ausencia del dato. Respétalo.

## `GET /venues/resolve`

`?path={segmento}` — traduce el segmento de una URL web a un id, para que un deep
link `vivevallenorte.com/venue/panaderia-la-espiga` abra la ficha correcta.

Acepta el slug del nombre, el slug con short-id y el UUID.

```jsonc
{ "ok": true, "data": {
  "id": "543882c2-41cf-4c44-a587-972a0842fbbf",
  "name": "IMPERIAL Fitness Club",
  "web_path": "/venue/imperial-fitness-club"
} }
```

404 si no existe o es de ClickLocal general.

## `GET /feed`

Las actualizaciones del día de toda la zona: negocios con texto o foto del día de
**menos de 24 h**, más recientes primero, más los avisos de la casa.

```jsonc
{ "ok": true, "data": {
  "announcements": [ /* solo en la primera página */ ],
  "venues": [ /* ApiVenue, todos con daily_update != null */ ],
  "next_cursor": null,
  "total": 12
} }
```

Los avisos encabezan el feed y **no son tappables**. Vienen solo cuando pides sin
cursor; en las páginas siguientes llegan como `[]`.

El campo del aviso se llama **`text`** (en la base la columna es `body`; usa
`text`).

`daily_update` ya viene `null` cuando caducó: no recalcules la frescura.

## `GET /cupones`

Ofertas y cupones vigentes de la zona, **agrupados por negocio**. Es la pestaña
Cupones y la superficie que paga el negocio Pro.

`?fraccionamiento={slug}` para filtrar (404 si el slug no existe).

```jsonc
{ "ok": true, "data": {
  "groups": [
    {
      "venue_id": "…",
      "venue_name": "Panadería La Espiga",
      "venue_logo_url": "https://…",
      "venue_web_path": "/venue/panaderia-la-espiga",
      "fraccionamiento_id": "…",
      "promotions": [
        {
          "id": "…", "venue_id": "…",
          "kind": "promo",            // "promo" = oferta informativa | "coupon" = canjeable
          "title": "2x1 en café",
          "description": "Solo de 8 a 11 am",
          "discount_label": "2x1",    // badge: "2x1", "20% OFF", "-$50"
          "code": null,               // solo en kind "coupon"
          "image_url": "https://…",
          "terms": "No acumulable",
          "starts_at": null, "ends_at": "2026-11-01T06:00:00Z",
          "is_active": true, "views": 31, "taps": 4,
          "created_at": "…", "updated_at": "…"
        }
      ]
    }
  ],
  "next_cursor": null,
  "total": 7
} }
```

- **La paginación cuenta grupos (negocios), no promociones**: partir un negocio
  entre dos páginas rompería el agrupado, que es lo que da valor a la vista.
- Dentro de cada grupo, **las ofertas van antes que los cupones**. Los grupos se
  ordenan por promo más reciente. Nunca se intercalan negocios.
- Todo lo necesario para pintar la tarjeta completa viene aquí: no pidas la ficha
  solo para eso.
- `views` y `taps` son los contadores acumulados; no los muestres al usuario final.

⚠️ **Maneja el negocio dado de baja.** `/cupones` no filtra por `is_active` (deuda
anterior a esta API, heredada del servicio que alimenta la web). Un negocio VVN
desactivado con promociones vigentes todavía aparece aquí, y su `/venues/{venue_id}`
responde **404**. No asumas que todo `venue_id` de un grupo abre ficha: si da 404,
quita la tarjeta en vez de mostrar un error.

Registra las vistas con [`POST /stats/promotions`](#post-statspromotions).

## `GET /blog`

`?cat=` con `guia | evento | anuncio | noticia`. `?limit=`, `?cursor=`.

Los slugs no distinguen mayúsculas: `/blog/Cafe-Pan` y `/blog/cafe-pan` resuelven
igual. Lo mismo en `/fraccionamientos/{slug}`, `/cupones?fraccionamiento=` y
`/venues/resolve`.

```jsonc
{ "ok": true, "data": {
  "posts": [ { "id": "…", "title": "Café, pan y algo más",
               "slug": "cafe-pan-y-algo-mas", "excerpt": "…",
               "body": "…", "cover_url": "https://…", "category": "guia",
               "published_at": "2026-10-11T12:00:00Z", "is_active": true,
               "created_at": "…", "updated_at": "…" } ],
  "next_cursor": null, "total": 2
} }
```

Solo posts publicados (`published_at <= ahora`). Los borradores no salen.

## `GET /blog/{slug}`

```jsonc
{ "ok": true, "data": {
  "post": { /* como arriba */ },
  "venue_cards": {
    "marisa": { "slug": "marisa", "name": "Marisa",
                "href": "/venue/marisa", "imageUrl": "https://…",
                "categoryLabel": "Panadería / Pastelería",
                "plazaName": "Plaza Altures",
                "plazaHref": "/capital-norte/plaza-altures" }
  }
} }
```

### Cómo renderizar `body`

Es texto plano con tres tokens, línea por línea:

| Línea | Render |
|---|---|
| `## Título` | Encabezado grande |
| `@venue:slug \| descripción` | Tarjeta del negocio, con los datos de `venue_cards[slug]` |
| resto | Párrafo, respetando saltos de línea |

Dentro del texto, `[etiqueta](url)` son enlaces: internos los abres en la app,
externos en el navegador.

`venue_cards` ya viene **resuelto** para que no hagas N llamadas al abrir un post.
Si un slug no está en el mapa, degrada a un enlace de texto: no rompas el post.

---

# Escritura

Todas van por POST con `Content-Type: application/json`, responden
`private, no-store` y están limitadas por IP. Son **fire-and-forget**: si falla
una métrica, no se lo muestres al usuario.

La plataforma se declara con `X-Platform: ios | android` (o el campo `platform` en
el body). **Mándala siempre**: es lo que permite separar web de app en el
dashboard.

## `POST /stats/venue`

```jsonc
// { "venueId": "uuid", "kind": "view" | "whatsapp" | "website" }
{ "ok": true, "data": { "recorded": true } }
```

- `view` al abrir la ficha.
- `whatsapp` al tocar el botón de WhatsApp.
- `website` al tocar el enlace del sitio.

## `POST /stats/vvn`

```jsonc
// { "id": "uuid", "kind": "plaza" | "parque" }
{ "ok": true, "data": { "recorded": true } }
```

Al abrir una plaza o un parque.

## `POST /stats/promotions`

```jsonc
// { "ids": ["uuid", "…"], "kind": "view" }   // lote, al mostrar las promos
// { "id": "uuid", "kind": "tap" }            // al copiar el código de un cupón
{ "ok": true, "data": { "recorded": 40, "received": 50, "rejected": 10, "max_per_request": 100 } }
```

**Manda las vistas en lote**, no una petición por promo: el limitador es de 30/min
y una pantalla de cupones lo quemaría en una sola carga.

El tope es **100 ids por petición**; mandar más de 200 se rechaza con 400. La
respuesta te dice exactamente qué pasó:

- `received` — cuántos mandaste (crudo).
- `rejected` — cuántos se cayeron por no ser UUID o por venir repetidos.
- `recorded` — cuántos se registraron de verdad.

**Compara los tres.** Si `recorded < received`, algo se perdió: o mandaste basura
(revisa tu lado) o pasaste del tope (manda el resto en otro lote).

## `GET /ratings`

`?venueId={uuid}`. Manda `X-Visitor-Id`.

```jsonc
{ "ok": true, "data": { "sum": 42, "count": 11, "mine": 4 } }
```

- `mine` es `null` si este visitante no ha votado.
- Promedio = `sum / count`, **pero no lo muestres con `count < 3`**: debajo del
  umbral invita a calificar. Es nuestra regla de producto, no una sugerencia.
- `private, no-store`, sin ETag.

⚠️ **No lo llames en cada apertura de ficha.** Es la única lectura que no se puede
cachear, así que cada llamada es una invocación de función garantizada — y el
promedio (`stats.rating_sum` / `stats.rating_count`) ya viene dentro del payload
cacheado de la ficha. Lo único que agrega este endpoint es `mine`.

Guarda el voto propio en local (Keychain / DataStore) cuando hagas el POST y
llama a este GET solo cuando no tengas voto local para ese negocio, o cuando el
usuario vaya a tocar las estrellas. Pintar el promedio con lo que ya trae la ficha
es correcto y gratis.

## `POST /ratings`

```jsonc
// { "venueId": "uuid", "stars": 4 }
{ "ok": true, "data": { "sum": 46, "count": 12, "mine": 4 } }
```

Un voto por visitante por negocio, **corregible**: volver a enviar cambia el
promedio sin inflar el conteo.

Sin texto libre y sin moderación: el usuario toca una estrella y listo.

| Respuesta | Qué hacer |
|---|---|
| `400 invalid_stars` | Bug tuyo: solo 1–5 enteros |
| `400 not_rateable` | Ese negocio no es de VVN: esconde la sección |
| `429 daily_limit` | "Alcanzaste el máximo de calificaciones por hoy" |
| `ok` con `sum: null` | El voto **sí se guardó**; conserva los contadores que tenías |

## `POST /track`

```jsonc
// { "event": "app_open", "entityType": "venue", "entityId": "uuid",
//   "fraccionamientoId": "uuid", "meta": { "tab": "cupones" } }
{ "ok": true, "data": { "recorded": true } }
```

Eventos de las apps: `app_open`, `push_received`, `push_open`, `coupon_save`,
`tab_select`, `notif_optin`.

También puedes mandar los de interfaz que comparte la web: `directions`,
`promo_share`, `instagram_tap`, `photos_open`, `catalog_open`, `claim_business`,
`plaza_rent`, `report_info`, `search`, `search_no_results`, `menu_option`,
`load_more`, `segment_select`.

⚠️ **Estos NO se aceptan y responden `400 invalid_event`:** `venue_view`,
`venue_whatsapp`, `venue_website`, `plaza_view`, `parque_view`, `promo_view`,
`promo_copy`, `rating_submit`, `ocasion_view`, `ocasion_whatsapp`, `ad_tap`.

Los escribe el servidor dentro de las rutas de `/stats/*`, junto con su contador.
Si además los mandaras por `/track`, cada interacción contaría **dos veces** — que
es exactamente lo que pasó en octubre de 2026. Usa `/stats/*` para esos.

`meta`: objeto plano, máximo **8 claves** de 40 caracteres, valores de texto
recortados a 120. `platform` lo sella el servidor y ocupa una de las 8.

## `POST /devices`

**Estado actual:** las entradas válidas responden `503 unavailable`, sin guardar
tokens. La tabla legacy todavía no tiene el contrato de aislamiento por marca y
permisos para el operador. La ruta se habilitará después de adaptar ese esquema
desde el proyecto central; aplicar solo la migración legacy no la habilita.

```jsonc
// {
//   "token": "fcm-o-apns-token",
//   "platform": "ios" | "android",
//   "installId": "uuid estable de la instalación",
//   "fraccionamientoSlug": "capital-norte",
//   "topics": ["ofertas", "blog"],
//   "appVersion": "1.0.0"
// }
{ "ok": true, "data": { "registered": true } }
```

Llámalo **al arrancar** y **cada vez que el sistema rote el token**.

⚠️ **Manda `installId`.** Es un UUID que generas una vez y guardas mientras la app
esté instalada (junto al `X-Visitor-Id`), y es la clave con la que se deduplica el
dispositivo. El token de push **no sirve para eso**: FCM y APNs lo rotan, así que
sin `installId` cada rotación crea un registro nuevo y el anterior se queda
suscrito — el mismo teléfono acaba recibiendo la notificación dos veces.

**503 `unavailable`** significa que el registro de notificaciones todavía no está
provisionado del lado del servidor. No es tu culpa ni un error del usuario:
reintenta en el siguiente arranque y no muestres nada.

Manda `X-Visitor-Id` si ya lo tienes: permite correlacionar dispositivo y
visitante sin guardar nada en claro.

Límites: token ≤ 512 caracteres, ≤ 20 `topics` de ≤ 40 caracteres, `appVersion`
≤ 32. Un `fraccionamientoSlug` con mala forma se descarta pero el token se
registra igual (perder el filtro por zona es mejor que perder el token).

**Todavía no hay baja.** No existe `DELETE /api/v1/devices`, así que por ahora no
puedes desuscribir un dispositivo cuando el usuario revoca el permiso. Se agregará
junto con el envío.

El **envío** de notificaciones es trabajo de admin y no es parte de esta API.

---

## El tipo Venue

`ApiVenue` es lo que devuelven todos los endpoints que traen negocios.

```jsonc
{
  "id": "uuid",
  "name": "Panadería La Espiga",
  "type": "food",                  // "food" | "service" | "both" | "product"
  "description": "…",
  "category": "panaderia",         // giro curado; null = sin clasificar
  "tags": ["pan artesanal"],
  "is_active": true,

  // Estado CRUDO: recalcúlalo tú (ver arriba)
  "status": "open",                // "open" | "closed"
  "status_updated_at": "…",
  "opening_hours": [ { "closed": false, "open": "08:00", "close": "21:00" } /* ×7 */ ],
  "status_override": null,
  "status_override_until": null,

  "contact": {
    "phone": "523312345678",
    "instagram": "https://instagram.com/…",
    "cta": "whatsapp",             // "whatsapp" | "website" — qué botón fijo pintar
    "website_url": null
  },
  "location": {
    "lat": 20.78, "lng": -103.42,
    "reference": "Plaza Altures, local 4",
    "address": "Av. …",
    "is_ambulatory": false,
    "is_closed_door": false        // true = NO publiques dirección ni mapa
  },
  "media": { "logo_url": "https://…", "cover_url": "https://…" },

  "daily_update": {                // null si no hay o si caducó (>24 h)
    "text": "Hoy conchas recién salidas",
    "image_url": "https://…",
    "updated_at": "…"
  },
  "stats": {
    "views": 120, "whatsapp_taps": 14, "website_taps": 2,
    "rating_sum": 42, "rating_count": 11
  },

  "catalog_pdf_url": null,
  "catalog_updated_on": null,      // "YYYY-MM-DD"

  // Vive Valle Norte
  "fraccionamiento_id": "uuid",    // nunca null en esta API
  "plaza_id": "uuid",              // null = suelto del coto (Oxxo, farmacia)
  "local_number": "4",
  "floor": "PB",
  "location_note": "frente al food court",
  "is_premium": true,
  "is_featured": false,
  "is_deprioritized": false,

  "created_at": "…",
  "updated_at": "…",

  // Calculados por el servidor
  "is_pro": true,                  // false ⇒ pinta la ficha capada
  "has_promo": true                // ⇒ badge "Oferta" en la tarjeta
}
```

### Lo que NO viene, y por qué

`contact.bot_phone`, `telegram_chat_id`, `whatsapp_wa_id`, `owner_id` y
`paid_until` **no salen por esta API**. Los tres primeros son el teléfono personal
y el chat del dueño, con los que edita su ficha por bot: en un JSON paginable
serían un directorio enumerable de teléfonos. Los otros dos son estado interno.
Lo que necesitas para decidir qué pintar es `is_pro`.

El servidor usa una **lista blanca** de campos: una columna nueva solo aparece si
alguien la agrega a mano. Si te falta un campo, es eso y no un bug tuyo.

### La matriz de negocio

| `fraccionamiento_id` | `plaza_id` | Qué es |
|---|---|---|
| set | set | Local de plaza — **capado hasta que paga** |
| set | `null` | Suelto del coto (Oxxo, farmacia) |
| `null` | `null` | ClickLocal general — **no sale por esta API** |

Esa última fila es "la pared" y se aplica en el servidor. Si alguna vez recibes un
negocio con `fraccionamiento_id: null`, es un bug grave: repórtalo.

---

## Imágenes

Todas las URLs de imagen (`media.logo_url`, `media.cover_url`, `photos[].url`,
`image_url`, `cover_url`) apuntan **directo a Supabase Storage** y ya vienen
optimizadas (WebP, ≤1200 px). Descárgalas tal cual y cachéalas en disco.

⚠️ **No las pases por `/_next/image`.** Ese es el optimizador de imágenes de
Vercel y se factura por cada combinación única de (imagen, ancho, calidad,
formato). Redimensionar del lado del cliente es gratis; hacerlo por esa ruta
costaría dinero por cada tamaño de pantalla.

## Contenido que va compilado en la app

**No** pidas por red: FAQ, Acerca de, Contacto, Privacidad y Términos. Son texto
que cambia una vez al año y debe verse sin señal. Compílalos.

Lo que sí sale de `/config` porque cambia: WhatsApp, correo y los precios del Plan
Pro.

---

## Cómo verificar

Contra un **build de producción** (en `next dev` las rutas se ejecutan siempre y el
caché no se puede observar):

```bash
npm run build && npx next start -p 3123
npm run check:v1 -- http://localhost:3123
```

`scripts/check-v1-contract.ts` valida la forma de cada respuesta, los códigos de
estado, las cabeceras de caché, el ETag/304, que no se filtren los campos privados
del dueño y que la pared siga intacta.

⚠️ **Por default no escribe nada.** Las comprobaciones con escrituras válidas en
estadísticas y analítica están detrás de `--writes`, que se niega a correr contra
un Supabase hospedado salvo `ALLOW_PROD_WRITES=1`. Verifica el entorno del servidor
antes de usarlas. `npm run smoke:local` usa solo Auth/PostgREST sintéticos y
bloquea la red externa de la API; es la opción para verificar sin datos reales.

También hay pruebas unitarias sin red ni base (`npm test`): el contrato de
`respond.ts` (ETag, 304, que lo privado no se cachee, que un 500 no filtre el
mensaje de Postgres) y el de `dto.ts` (la lista blanca de campos privados, la
pared, la paginación).

### Pendiente de infraestructura

La API necesita el esquema compartido `directory_brands` y un operador de VVN
aprovisionado en el entorno elegido. `POST /devices` permanece en **503
(`unavailable`)** hasta adaptar la tabla y sus permisos por marca en el proyecto
central; la migración legacy incluida no debe aplicarse tal cual.
