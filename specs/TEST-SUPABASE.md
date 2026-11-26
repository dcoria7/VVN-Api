# Supabase de pruebas — estado al 19 de noviembre de 2026

## Entorno

- Proyecto de pruebas: `vvn-pruebas` (`msfrkqfvdhyjnktwuhzd`), PostgreSQL 17.12.
- Origen del esquema: proyecto compartido `ClickLocal` (`loghgtlcxoqtltppggnd`).
- Las conexiones y contraseñas viven en `.env.schema-copy.local`, fuera de Git.
- La configuración de la API ya está preparada en `.env.local`, con la URL y
  clave publicable de pruebas, UUID de VVN y un salt exclusivo de pruebas.
  Ambos operadores ya están configurados y sus logins fueron verificados.

## Paso 2 completado: copia de estructura

Se exportaron únicamente los esquemas de aplicación `public` y `private` usando
pg_dump 17.12, con conexión al origen en modo de solo lectura. Se revisó el SQL
antes de aplicarlo al destino vacío. No se ejecutaron semillas ni resets
históricos. No se copiaron filas, usuarios Auth, archivos Storage ni secretos.

La copia quedó registrada en pruebas como
`application_schema_baseline_for_vvn_tests`. La función `rls_auto_enable` ya
existía en el destino por la opción de habilitar RLS automáticamente; se conservó
y se restringió su ejecución para PUBLIC/anon/authenticated mediante
`restrict_execution_of_automatic_rls_event_trigger`.

## Verificación

Coinciden con el origen:

| Elemento | Cantidad |
| --- | ---: |
| Tablas | 23 |
| Columnas | 260 |
| Constraints | 83 |
| Funciones de aplicación copiadas | 15 |
| Políticas RLS | 52 |
| Índices | 83 |
| Triggers de tablas | 20 |

Al terminar la copia, todas las tablas de aplicación estaban vacías y tenían RLS
activo. Los permisos
efectivos de tablas, columnas, funciones copiadas y esquemas para `anon`,
`authenticated` y `service_role` coinciden con los del origen. La función de RLS
automático del destino es adicional y no forma parte de las 15 copiadas.

El advisor de seguridad no reporta WARN/ERROR tras restringir esa función.
Conserva tres avisos informativos de RLS sin políticas en `brand_operators`,
`venue_instagram_posts` y `venue_instagram_stories`. No se agregaron políticas
para abrirlas: el acceso administrativo a asignaciones y el futuro acceso a
Instagram requieren decisiones específicas.
[Descripción del aviso de RLS sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## Integración real verificada

Se ejecutaron 242 comprobaciones directamente por Auth/PostgREST con los JWTs de
los dos operadores y 245 comprobaciones HTTP/persistencia sobre el build real de
VVN-API, conectado exclusivamente a este proyecto de pruebas.

Se verificaron lecturas sin filtros de marca en el cliente, UUIDs ajenos,
updates/deletes ajenos, marca inmutable, relaciones cruzadas, permisos sobre
`brand_operators`, slugs repetidos, siete RPCs de contadores y el trigger de
calificaciones (alta y corrección sin duplicar el conteo).

Las rutas HTTP verificaron las lecturas públicas, privacidad de DTOs, ETag/304,
calificaciones privadas sin caché pública, rechazo de IDs ajenos, lotes mixtos de
promociones sin escrituras parciales, persistencia de contadores y votos, y
`503 unavailable` en dispositivos. La resolución por prefijo de UUID también se
probó sobre Postgres real, con control positivo de VVN y rechazo de otra marca.

Los datos sintéticos se conservan en el entorno para continuar la integración.
Los manifiestos y resultados locales están en `.test-results/`, excluido de Git.
No se usaron credenciales ni datos de producción.

Para reproducir desde VVN-API con Node.js 22 y `.env.local` configurado:

```sh
npm run verify:test-db
npm run build
npm run verify:test-api
```

`verify:test-db` crea un conjunto sintético nuevo por ejecución, usando solo los
operadores y sin service role. `verify:test-api` usa los últimos fixtures e inicia
y cierra el servidor de la API en un puerto local libre. Ambas pruebas rechazan
URLs distintas de `vvn-pruebas`. El servidor de prueba bloquea `fetch` a otros
proyectos y servicios.

## Prioridad 4 completada: fallas de datos y respuestas

Las lecturas propagan errores de Supabase como 500 genérico sin caché; las
colecciones vacías y ausencias reales conservan su significado. Los payloads
compuestos rechazan fallas en sus secciones y no cachean resultados parciales.
Las ausencias no se guardan en la caché interna de 300 s. Se versionaron las
claves para dejar de usar resultados vacíos anteriores.

Se mantuvieron dos respuestas deliberadas: `/config` sigue entregando el
interruptor de emergencia con `X-Data-Degraded: 1` y sin caché si falla su lectura;
un voto ya guardado se confirma con contadores `null` si falla la relectura.
Los contadores dependen del RPC atómico y la analítica secundaria reporta sus
errores. Los lotes de promociones siguen sin transacción ni idempotencia:
un error intermedio puede dejar incrementos confirmados de algunos IDs.

Validación de esta prioridad:

- 137 pruebas unitarias correctas, incluidas 40 de fallas, ausencias y escrituras.
- 134 comprobaciones del contrato HTTP y 43 peticiones de aislamiento correctas.
- 58 peticiones con inyección de fallas y recuperación sobre el build y caché
  real de Next, usando exclusivamente un backend ficticio en memoria.
- 245 comprobaciones HTTP/persistencia contra `vvn-pruebas`, correctas.
- Compilación y revisión de tipos correctas. Sin despliegue ni cambios de esquema.

Para reproducir las fallas controladas, ejecutar `npm run build:local` y después
`npm run smoke:local`. Para volver a probar Supabase real, ejecutar
`npm run build` y `npm run verify:test-api`. La inyección de fallas nunca se
ejecuta contra Supabase remoto. El CDN de un despliegue sigue fuera de estas pruebas.

## Siguientes pasos

Las dos marcas de prueba ya están creadas y activas:

| Slug | UUID en pruebas |
| --- | --- |
| `vive-valle-norte` | `93e6b81d-1add-4252-a314-fd9c2fbb8890` |
| `otra-marca-pruebas` | `78e45cd4-bf74-4c1a-a8ed-8dbdc094c872` |

Los dos usuarios Auth ya tienen correo confirmado y quedaron asociados en
`brand_operators`: el correo con alias `+vvn` a VVN y el alias `+vvn2` a la otra
marca. No se copiaron usuarios ni contraseñas de producción.

1. Completar pantallas y acciones de las apps usando los servicios de cliente ya conectados.
2. Adaptar `device_tokens` desde el proyecto central antes de habilitar push.

Los artefactos temporales de exportación y comparación están en
`/private/tmp/vvn-schema-copy-aNPo4w/`; pueden ser eliminados por el sistema.
Las migraciones del destino conservan el SQL aplicado. La base original no fue
modificada por este procedimiento.

## Preparación de staging y production

Staging quedó identificado explícitamente y asociado a `vvn-pruebas`.
Production tiene configuración separada y se bloquea si faltan sus valores reales;
no se crearon recursos ni se realizaron despliegues de production. El contrato y
los comandos están en `specs/ENVIRONMENTS.md`.

La verificación de esta etapa incluyó 150 pruebas unitarias de la API, 290
comprobaciones HTTP/persistencia y 124 pruebas del cliente Kotlin, incluida una
integración real opt-in con la API local de staging. Android Staging Debug,
framework iOS para dispositivo/simulador arm64 y app Swift de staging compilaron.
La UI de las apps no se ejecutó en dispositivos/simuladores en esta etapa.

Se aplicaron los cambios al proyecto `VVN app` y se regeneró su proyecto Xcode.
Los servicios de lecturas, estadísticas, calificaciones y tracking están disponibles;
push permanece bloqueado. Las pantallas existentes de Explorar/ficha utilizan
HTTP por defecto; Cupones/Hoy/Más, controles de votos y eventos de interacción
necesitan la siguiente integración de UI.
