# Revisión de la extracción

## Estado actual: aislamiento de VVN (2026-11-19)

Las secciones de extracción y verificación original de abajo documentan el
snapshot inicial. La API ya no usa su acceso histórico con service role:

- `VVN_BRAND_ID` es obligatorio, privado del servidor y forma parte de las claves
  de caché y del espacio de rate limiting. Ningún header, query o body cambia marca.
- Todas las consultas pasan por un operador autenticado. Su JWT se verifica
  contra el registro activo de `brands` con UUID configurado y slug
  `vive-valle-norte`; la autorización efectiva depende de `brand_operators`/RLS.
- Un adaptador agrega `brand_id` a lecturas, updates e inserts/upserts. Rechaza
  tablas fuera del contrato. Los slugs se resuelven dentro de la marca.
- Antes de ejecutar contadores, calificaciones o track se verifican los IDs
  recibidos. Los lotes de promociones con IDs ajenos se rechazan sin escrituras.
- `brand_id` se mantiene en el modelo interno de Venue, pero no sale en el DTO.
- `/devices` devuelve `503 unavailable` y no consulta ni escribe la tabla legacy.
  `directory_brands` no incluyó `device_tokens`; habilitar push requiere adaptar
  su esquema y permisos desde el proyecto central, con pruebas de aislamiento.
- La API no aprovisiona operadores ni ejecuta migraciones. No se cambió la web.

Las pruebas unitarias y HTTP usan dos marcas sintéticas, slugs repetidos y
controles positivos y negativos de escrituras. La simulación HTTP comprueba el
ámbito explícito sin filtrar lecturas por su cuenta; no sustituye RLS real.
Los permisos, RLS, triggers y RPCs ya se verificaron contra `vvn-pruebas`; ver
`specs/TEST-SUPABASE.md` para resultados y reproducción.

## Manejo de fallas de datos (prioridad 4)

Las lecturas distinguen ausencia real de error: los servicios propagan un error
contextual y las rutas responden 500 genérico sin caché. Las fichas y payloads
compuestos no guardan secciones incompletas. La caché interna no persiste ausencias;
el 404 público conserva únicamente su política HTTP corta de 10 s + 10 s stale.
Las claves se versionaron para descartar resultados vacíos de la implementación
anterior.

`/config` conserva el interruptor de emergencia cuando falla la lectura de datos,
con una señal explícita de degradación y sin caché. Un voto ya guardado sigue
confirmado si falla la relectura de sus contadores, que llegan como `null`.
Los contadores requieren sus RPCs atómicos y registran eventos de éxito después
de confirmarlos. La analítica secundaria sigue siendo best-effort, con reporte
de errores. Los lotes de promociones siguen sin transacción ni idempotencia;
una falla intermedia puede dejar incrementos parciales.

La resolución por prefijo de UUID usa límites de rango válidos en Postgres.
El resolvedor por nombre conserva el escaneo de negocios activos de la marca;
una columna slug indexada sigue siendo una mejora futura del esquema central.

## Resultado

Se conservan las 17 rutas `/api/v1` (18 combinaciones de método y ruta), sus
respuestas, validaciones, DTOs y lógica de datos. Se copiaron las dependencias
transitivas de código: 54 archivos de ejecución, incluidos los 17 controladores,
y las tres suites existentes (76 pruebas). No hay imports sin resolver ni enlaces
simbólicos hacia el proyecto web.

La carpeta no es un worktree: no comparte `.git`, `node_modules` ni archivos de
código con ClickLocalWebApp. Las dependencias npm se instalaron en esta carpeta,
con versiones fijadas y lockfile propio. La compilación produce un bundle Node
autocontenido. No se añadieron remotos Git ni asociaciones de Vercel.

El único cambio al import de una ruta de la API es la reubicación del resolvedor:
`src/app/venue/[id]/resolve-venue.ts` pasa a
`src/server/api/resolve-venue.ts`. Su implementación se conserva. Esto elimina la
dependencia estructural del árbol de páginas. Se añadieron configuración mínima,
raíz de salud, pruebas de aislamiento y documentación de operación.

Se omitieron páginas, componentes, CSS, fuentes, autenticación de administrador,
webhooks, procesamiento de imágenes y otros endpoints de la web. Los cambios que
la rama original hacía sobre esas superficies no se aplicaron a `main`.
Algunos archivos compartidos conservan funciones adicionales de la web, aunque
no hay rutas que las expongan. Recortarlas o reescribirlas no era necesario para
separar el despliegue y podría cambiar reglas de negocio heredadas.

## Dependencias que siguen existiendo al desplegar

| Dependencia | Efecto de separar la carpeta |
| --- | --- |
| Supabase | El servicio requiere un esquema compatible. Compartir producción en el futuro compartiría datos; esta extracción no lo conecta. |
| Acceso actual a datos | URL, clave publicable, `VVN_BRAND_ID` y credenciales del operador de VVN. Sin service role. |
| Calificaciones | `RATING_SALT` debe coincidir con el salt efectivo de la web si más adelante comparten DB. La web antigua puede usar `ADMIN_SECRET` como fallback. Configurar el valor equivalente en `RATING_SALT` evita compartir la contraseña de administrador y conserva los hashes. |
| Caché | `unstable_cache` y el CDN pertenecerán al nuevo despliegue. Los `revalidateTag` de la web no invalidan la caché de la API. Conserva expiraciones propias; si se exige actualización inmediata hará falta invalidación entre servicios. La frescura depende también de `s-maxage` y `stale-while-revalidate`. |
| Redis | Es opcional; sin configurar usa limitadores en memoria. Si ambos servicios apuntan al mismo Redis, las claves `rl:*` pueden compartir cupos por IP y tipo de operación. Elegir una instancia distinta si se quieren cupos independientes. |
| Sentry | Conserva inicialización de servidor y reporte de errores, sin copiar DSN ni proyecto de despliegue. El envío de source maps requiere configuración propia más adelante. |
| URLs web | Los deep links y URLs de negocio siguen llevando a la web. Eso es una referencia pública, no un import ni una llamada obligatoria a su servidor. |
| API móvil | Esta API es de VVN. No traslada los flujos generales de ClickLocal, Ocasión ni administrador. |

## Contrato de base de datos

Lecturas: `venues`, `fraccionamientos`, `plazas`, `parques`, `menu_items`,
`services`, `promotions`, `venue_photos`, `vvn_announcements` y `blog_posts`.
Las calificaciones también leen `venue_ratings`.

Escrituras explícitas de la API: contadores mediante las RPCs existentes,
`analytics_events`, `venue_ratings` y `device_tokens`. Las calificaciones dependen
del trigger existente que actualiza `venues.rating_sum` y `rating_count`.
Separar código no transforma estas operaciones en solo lectura: al conectar un
entorno real, los POST válidos escriben en la base configurada.

La única migración nueva de la rama para la API es
`supabase/migrations/20261019120000_device_tokens.sql`. Se conserva sin modificar
y sin ejecutar. No es un esquema completo para crear un Supabase desde cero: el
resto de tablas, RPCs, permisos y triggers son prerrequisitos del sistema actual.
La ruta de dispositivos permanece en `503 unavailable` hasta adaptar el esquema
legacy al operador por marca; la migración incluida no basta para habilitarla.

## Verificación realizada

- Build de producción con URL de Supabase local y claves ficticias: correcto.
- TypeScript y resolución de imports: correctos.
- 76 pruebas originales: correctas (privacidad de DTOs, separación ClickLocal/VVN,
  paginación, UUIDs, ETag/304 y errores sin detalles internos).
- 135 comprobaciones del contrato sobre el bundle standalone: correctas, usando
  únicamente un PostgREST simulado en memoria con fraccionamiento, plaza, parque,
  negocios, cupón, blog y aviso sintéticos.
- El smoke prueba también POST válidos de analítica y dispositivos, únicamente
  contra memoria local. No se aplicó SQL ni se usó un Supabase real.
- `/admin`, `/vvn` y webhooks Telegram/WhatsApp: 404 en el servicio extraído.
- Rewrites externos: ninguno. Enlaces simbólicos externos: ninguno.
- Proyecto web al terminar: rama `main`, sin cambios en archivos versionados;
  mismos tres elementos sin seguimiento que ya existían al inicio.

Las pruebas HTTP verifican rutas, formato y comportamiento de caché, no políticas
RLS, integridad relacional, entrega de notificaciones ni comportamiento real del
CDN. Eso requiere una integración posterior en un entorno de pruebas.

## Arquitectura heredada

La separación permite desplegar la API por su cuenta. No supone una reescritura
completa de su arquitectura. Diagnóstico Clean Architecture: 2 de 7 criterios,
aproximadamente 3/10. Hay reglas puras comprobables y un grafo de imports sin
ciclos. Persisten dependencias directas de Supabase y Next dentro de servicios y
helpers; faltan puertos de persistencia, casos de uso aislados y un punto de
composición explícito. Si se decide refactorizar después, esas fronteras son el
siguiente paso. No es necesario cambiarlas para ejecutar esta extracción.
