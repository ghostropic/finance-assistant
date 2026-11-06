import { config } from "dotenv"
import { defineConfig } from "prisma/config"

config({ quiet: true })

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Read lazily so `prisma generate` works before .env exists.
    url: process.env.DATABASE_URL ?? "",
  },
})
