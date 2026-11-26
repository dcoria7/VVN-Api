import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Vitest para los tests unitarios de lib/ y de validación de input de las API
// routes. `server-only` se stubbea porque su export por defecto lanzaría fuera
// de RSC, y los alias @/ replican los paths del tsconfig de Next.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    env: { VVN_ENVIRONMENT: "staging", VVN_BRAND_ID: "00000090-1111-4111-8111-111111111111" },
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
