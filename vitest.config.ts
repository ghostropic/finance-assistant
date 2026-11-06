import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Each test file starts its own in-memory Postgres; give it time to boot.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
})
