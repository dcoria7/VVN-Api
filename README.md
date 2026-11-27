# VVN API

API móvil de Vive Valle Norte extraída de `ClickLocalWebApp`, rama
`feat/api-v1-mobile`, commit `33784be`. Proyecto independiente con Next.js 16.2.1,
sin páginas web, administrador ni webhooks de los bots.

Desde la adaptación al esquema `directory_brands`, toda la API usa un operador
autenticado de VVN y filtros por `brand_id`. `VVN_BRAND_ID` es obligatorio y solo
se lee del entorno del servidor. No se usa `SUPABASE_SERVICE_ROLE_KEY` ni existe
un fallback a acceso global. Ver el estado actual en `specs/EXTRACTION.md`.

La extracción se hizo desde un snapshot de Git: el proyecto web conserva su rama
`main`, sus archivos y su configuración. No se copiaron credenciales reales,
configuración de Vercel ni vínculos al repositorio original. No se desplegó nada ni
se consultó o modificó la base de producción.

## Estado vigente y memoria de producto

La API general ya es consumida por las apps en
`https://api.vivevallenorte.com/api/v1`. Las notas de extracción y configuración
inicial de este README describen aquel momento; no implican que el dominio siga
pendiente. El endpoint nuevo `/descubre` se validó en staging: eso no confirma
que su migración y código ya estén publicados en producción.

Al retomar, leer [AGENTS.md](AGENTS.md), [el contrato de Descubre](specs/DISCOVER.md)
y [el último cierre](specs/ITERATIONS.md). El admin de destacados/patrocinados está
implementado localmente en la raíz web. Su integración con las apps sigue pendiente.

## Verificación local sin producción

Requiere Node.js 20.9 o superior. Desde esta carpeta:

```sh
npm ci
npm test
npm run build:local
npm run typecheck
npm run smoke:local
```

`smoke:local` abre Auth/PostgREST ficticios en `127.0.0.1:54321`, inicia el bundle
independiente en un puerto local libre y ejecuta el contrato HTTP. Usa datos
sintéticos y almacena las escrituras solo en memoria; al terminar cierra ambos
servidores. El proceso de la API bloquea cualquier `fetch` fuera del servidor
ficticio. `build:local` fuerza la configuración ficticia y elimina los `.env`
copiados al bundle generado; conserva intactos los archivos `.env` del proyecto.
El puerto 54321 debe estar libre. Si ya existe un Supabase local usando
ese puerto, la prueba se detiene sin conectarse a él.

Las pruebas incluyen autenticación del operador, filtros en consultas por slug,
dos marcas sintéticas con slugs repetidos, rechazo de IDs ajenos y escrituras
positivas de métricas y calificaciones. El backend ficticio exige el JWT del
operador y la marca en cada consulta/escritura. El backend ficticio no ejecuta RLS
ni triggers reales; estos se verifican por separado en `vvn-pruebas`.

Validación local: 150 pruebas unitarias, 134 comprobaciones del contrato HTTP,
43 peticiones de aislamiento entre marcas y 58 de fallas/recuperación. Estas
últimas comprueban sobre el caché real de Next que las fallas de lectura dan 500
sin caché ni resultados parciales, y que una ausencia real no queda guardada cinco
minutos en la caché interna. No se prueba un CDN desplegado.

## Staging y production

Staging ya tiene su configuración privada en `.env.staging.local` y usa
`vvn-pruebas`. Production tiene una plantilla separada en `.env.production.example`
y permanece pendiente de sus valores reales. Ver [specs/ENVIRONMENTS.md](specs/ENVIRONMENTS.md).

```sh
npm run build:staging
npm run start:staging
```

Para recarga automática: `npm run dev:staging`. Los tres comandos equivalentes
`:production` exigen completar `.env.production.local`. No reutilizan la configuración
ni el build de staging. Los servidores locales escuchan solo en `127.0.0.1:3123`.
`.env.local` se conserva para los scripts de verificación de Supabase de pruebas.

El entorno debe tener aplicada `directory_brands` desde el proyecto central y
un operador de VVN aprovisionado allí. La API verifica que el operador tenga acceso
al UUID configurado y al registro activo con slug `vive-valle-norte`. Las claves
del operador son exclusivas del servidor. No se crean usuarios ni se aplican SQL
al iniciar la API. Conservar el `RATING_SALT` efectivo de la web del mismo entorno.

`vvn-pruebas` ya está preparado y se verificaron sus dos operadores, RLS, RPCs,
triggers y las rutas HTTP de esta API. El estado y los comandos de reproducción
están en [specs/TEST-SUPABASE.md](specs/TEST-SUPABASE.md). Estas pruebas reales
escriben únicamente registros sintéticos y rechazan otros proyectos Supabase:

```sh
npm run verify:test-db
npm run build
npm run verify:test-api
```

La cuenta secundaria se configura mediante `TEST_OTHER_BRAND_ID`,
`TEST_OTHER_OPERATOR_EMAIL` y `TEST_OTHER_OPERATOR_PASSWORD` en `.env.local`.
Solo los scripts de verificación usan esas variables; la API sirve únicamente VVN.

Las rutas siguen bajo `/api/v1`. `GET /` identifica el servicio. El contrato está
en `specs/MOBILE-API.md`; los detalles de separación y dependencias están en
`specs/EXTRACTION.md` y la procedencia en `specs/EXTRACTION-MANIFEST.json`.

El registro de dispositivos está bloqueado: devuelve `503 unavailable` sin
guardar el token. La migración legacy incluida es solo una referencia y **no se
debe aplicar tal cual**: carece de marca y permisos para el operador. Su adaptación
se gestiona en el proyecto central. No hay scripts de arranque que apliquen SQL.

## Notas históricas del despliegue inicial

La carpeta puede convertirse en un repositorio propio y desplegarse como un
proyecto nuevo, por ejemplo en la misma cuenta de Vercel. Las variables de entorno
y el dominio de ese proyecto se configuran por separado. Para un servidor Node,
`npm run build` produce `.next/standalone/server.js`.

La URL de la API se configuraría en las apps móviles. Usar un subdominio propio no
requiere cambiar el código de la web. Conservar `/api/v1` dentro del dominio de la
web requeriría configurar el enrutamiento cuando se decida hacerlo. No se ha
configurado ninguna de estas opciones.

## Destacados y patrocinados de Descubre

`GET /api/v1/descubre` devuelve dos swimlanes independientes administrados por
registros persistidos: negocios destacados y campañas patrocinadas (venues,
inmuebles, encuestas u otros destinos). Si no hay contenido vigente, cada sección
incluye `visible:false` para ocultarla completamente. `/track` admite los eventos
de impresión/apertura/clic con atribución a selección o campaña.

Ver [specs/DISCOVER.md](specs/DISCOVER.md) para el contrato, las reglas del admin,
la migración y el estado de despliegue. Leer [AGENTS.md](AGENTS.md) al retomar y
actualizar la documentación cuando el usuario indique “travesura terminada”.

## Acceso de propietarios

`GET/POST /api/v1/owner` permite reclamar un QR emitido por el admin y editar
la ficha Pro vinculada al dispositivo. `POST /api/v1/owner/media` recibe imágenes
y prepara/confirma subidas directas de PDF. Ver [el contrato](specs/OWNER-API.md)
y ejecutar `npm run build:staging` seguido de `npm run verify:test-new-endpoints`
para comprobar HTTP, persistencia y Storage contra `vvn-pruebas`.
