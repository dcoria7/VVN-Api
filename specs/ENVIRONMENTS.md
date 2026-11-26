# Staging y production

Los dos ambientes tienen configuración, builds, credenciales, datos y apps
independientes. `NODE_ENV=production` solo indica un build optimizado de Next;
la identidad del producto se fija con `VVN_ENVIRONMENT=staging|production`.

| Recurso | Staging | Production |
|---|---|---|
| Supabase | `vvn-pruebas`, `msfrkqfvdhyjnktwuhzd` | Proyecto real por confirmar/configurar |
| API pública | Pendiente; por ahora `http://127.0.0.1:3123/api/v1` | URL real pendiente |
| Archivo local de API | `.env.staging.local` preparado | `.env.production.local` pendiente |
| Plantilla sin secretos | `.env.staging.example` | `.env.production.example` |
| App ID iOS/Android | `com.clicklocal.vvn.staging` | `com.clicklocal.vvn` |

## API local

```sh
npm run build:staging
npm run start:staging
```

Para desarrollo con recarga: `npm run dev:staging`. Staging se conecta
exclusivamente a `vvn-pruebas`; la simulación del smoke usa un backend local
sin un proyecto Supabase adicional.

La API exige que la URL coincida con `VVN_EXPECTED_SUPABASE_PROJECT_REF` y que
staging use el proyecto conocido. Production rechaza ese proyecto y los hosts
locales. Cada operador y `VVN_BRAND_ID` corresponde a su base. Los hashes de votos,
Redis y Sentry también deben tener configuración propia del ambiente.

Los scripts cargan únicamente el archivo del ambiente elegido y sobrescriben
los opcionales ausentes para que Next no los herede de otro dotenv. Los builds
requieren configuración completa. Cada build registra su ambiente y proyecto;
`start:staging`/`start:production` rechazan un build de otro ambiente. Recompilar
cuando cambie el ambiente: las variables `NEXT_PUBLIC_*` se fijan al compilar.
No reutilizar un bundle de staging en production.

Los dotenv copiados por Next se eliminan del bundle standalone después de
compilar. Los archivos fuente se conservan con permisos privados y fuera de Git.
En servidores remotos, inyectar las variables del ambiente correspondiente; no
subir archivos de contraseñas ni los manifiestos de pruebas.

`GET /` y `GET /api/v1/config` informan `environment`; las respuestas de las rutas
`/api/v1` incluyen `X-Vvn-Environment`. Esa identidad sale del servidor y no cambia
por headers, body o query del cliente. Las claves de caché y rate limiting
incluyen ambiente y marca.

## Apps

El proyecto móvil está en `../VVN app`. Android usa los flavors `staging` y
`production`; iOS usa los esquemas `VVN-Staging` y `VVN-Production`, cada uno con
configuraciones Debug y Release. Staging y production se pueden instalar juntos;
sus preferencias e identidad de visitante quedan separadas por app ID.

Android Staging Debug usa `http://10.0.2.2:3123/api/v1` en emulador; iOS Staging
Debug usa `http://127.0.0.1:3123/api/v1` en simulador. Las URLs remotas se fijan en
Gradle o xcconfig al compilar. HTTP se permite solo para hosts locales en staging
debug; production y staging release requieren HTTPS.

Production no elige servidor desde variables de ejecución y no tiene fallback a
fixtures. Staging debug permite fixtures solo por selección explícita de pruebas.
Los errores de red nunca cambian automáticamente la fuente de datos. El cliente
exige la cabecera del ambiente correspondiente y verifica la API antes de enviar
su primera escritura.

El cliente compartido cubre las lecturas de las 11 rutas GET y estadísticas,
ratings y track. Push sigue bloqueado sin transmitir tokens. Se conservaron las
pantallas existentes: las nuevas operaciones están disponibles en `api` del
contenedor, pero quedan pendientes las pantallas de Cupones/Hoy/Más y la conexión
de sus acciones, calificaciones y eventos. Los deep links necesitan registro y
navegación de cada plataforma además del servicio de resolución implementado.

## Activación futura de production

Completar su archivo usando `.env.production.example`, con proyecto, operador,
UUID de marca, claves y salt reales. Compilar mediante `npm run build:production`
y configurar las URLs públicas en cada app. No se crearon proyectos, operadores,
migraciones ni despliegues de production durante esta preparación.

La definición usa proyectos separados de staging y production, de acuerdo con
la [guía de ambientes de Supabase](https://supabase.com/docs/guides/deployment/managing-environments).
Las migraciones del esquema compartido siguen siendo responsabilidad del proyecto
central; no se deben reaplicar a ciegas sobre el esquema que ya se copió.

## Verificación de esta preparación

- API: 150 pruebas unitarias, tipos y build de staging correctos.
- Rutas/persistencia: 290 comprobaciones contra `vvn-pruebas` correctas.
- Cliente Kotlin: 124 pruebas correctas, incluida integración real con la API local.
- Android: APK Staging Debug generado; production bloqueado sin URL.
- iOS: framework para dispositivo/simulador arm64 y app Staging Debug compilados;
  production bloqueado sin URL. Proyecto Xcode regenerado en la carpeta original.
- Las suites de UI y el recorrido visual en dispositivos quedan pendientes.

Los resultados locales están en `.test-results/`; los scripts de integración
no ejecutan migraciones ni usan production.
