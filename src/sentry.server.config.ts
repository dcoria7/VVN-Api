import * as Sentry from "@sentry/nextjs";

// Runtime de Node.js (API routes, Server Components, Server Actions, webhooks).
Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  // Adjunta valores de variables locales a los stack frames del servidor.
  //
  // Solo en desarrollo: para capturarlas, Sentry engancha el inspector de Node y
  // mantiene activo un debugger en el proceso, con un costo de CPU que se paga en
  // TODA la ejecución, no solo cuando truena algo. En un plan donde el límite es
  // Fluid Active CPU (tiempo de CPU real), eso es caro para lo poco que aporta en
  // prod. Los stack traces siguen llegando completos; lo único que se pierde en
  // producción son los valores de las variables locales en cada frame.
  includeLocalVariables: process.env.NODE_ENV === "development",
});
