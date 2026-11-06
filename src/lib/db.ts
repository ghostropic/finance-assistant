import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@/generated/prisma/client"
import { databaseEnv } from "./env"

export function createDb(
  connectionString: string,
  options: { max?: number } = {},
): PrismaClient {
  const adapter = new PrismaPg({ connectionString, max: options.max })
  return new PrismaClient({ adapter })
}

// Kept on globalThis so Next.js dev reloads reuse it instead of opening a new pool each time.
const holder = globalThis as unknown as { __financeDb?: PrismaClient }

/** One client per process: each PrismaClient owns a connection pool. */
export function getDb(): PrismaClient {
  holder.__financeDb ??= createDb(databaseEnv().DATABASE_URL)
  return holder.__financeDb
}

/** Close the shared client if one was created. Safe to call from `finally`. */
export async function disconnectDb(): Promise<void> {
  await holder.__financeDb?.$disconnect()
  holder.__financeDb = undefined
}
