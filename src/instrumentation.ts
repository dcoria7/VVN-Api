import * as Sentry from "@sentry/nextjs";

// Carga la config de Sentry según el runtime del servidor.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/deployment-brand");
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captura automáticamente los errores de request del servidor (Server Components,
// route handlers, middleware). Requiere @sentry/nextjs >= 8.28.0.
export const onRequestError = Sentry.captureRequestError;
