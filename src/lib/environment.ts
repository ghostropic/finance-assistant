import type { PrismaClient } from "@/generated/prisma/client"
import type { PlaidEnvironment } from "./env"

// Sandbox and real data never share a database (docs/milestone-3.md). Mixing them
// would put fake transactions into every total, and Sandbox tokens fail with
// production keys.

export class EnvironmentMismatchError extends Error {}

/** Throws if the database holds banks connected under a different PLAID_ENV. */
export async function assertEnvironmentMatches(
  db: PrismaClient,
  environment: PlaidEnvironment,
): Promise<void> {
  const others = await db.plaidItem.findMany({
    where: { environment: { not: environment } },
    distinct: ["environment"],
    select: { environment: true },
  })
  if (!others.length) return
  const found = others.map((o) => o.environment).join(" and ")
  throw new EnvironmentMismatchError(
    `PLAID_ENV is ${environment}, but this database holds banks connected in ${found}. ` +
      'Each Plaid environment needs its own database: check DATABASE_URL and PLAID_ENV in your env file (docs/plan.md, "Switching to real data").',
  )
}
