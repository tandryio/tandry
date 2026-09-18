import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Only for what the black-box suite cannot reach: behaviour that depends on a
// Durable Object alarm, which the Workers runtime can fire on demand here.
// Everything else is tested over HTTP by `test/*.test.ts`.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { RETENTION_DAYS: "7", BETTER_AUTH_SECRET: "only-for-local-tests-not-a-production-secret-1234" } },
    }),
  ],
  test: { include: ["test/workerd/*.spec.ts"] },
});
