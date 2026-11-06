import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { PGLiteSocketServer } from "@electric-sql/pglite-socket"
import { createDb } from "@/lib/db"
import type { PrismaClient } from "@/generated/prisma/client"

// Tests run against PGlite: real Postgres 17 compiled to WebAssembly, running
// in-process and served over the Postgres wire protocol. No Docker needed,
// and every test file gets a fresh, migrated database.

const MIGRATIONS = join(import.meta.dirname, "../../prisma/migrations")

export interface TestDb {
  db: PrismaClient
  url: string
  stop: () => Promise<void>
}

export async function startTestDb(): Promise<TestDb> {
  const pg = await PGlite.create()
  for (const dir of readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()) {
    await pg.exec(readFileSync(join(MIGRATIONS, dir, "migration.sql"), "utf8"))
  }
  const server = new PGLiteSocketServer({ db: pg, host: "127.0.0.1", port: 0 })
  await server.start()
  const port = Number(server.getServerConn().split(":").pop())
  const url = `postgresql://postgres@127.0.0.1:${port}/postgres`
  const db = createDb(url, { max: 1 })
  return {
    db,
    url,
    stop: async () => {
      await db.$disconnect()
      await server.stop()
      await pg.close()
    },
  }
}
