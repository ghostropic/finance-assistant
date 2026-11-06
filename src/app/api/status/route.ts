import { getDb } from "@/lib/db"
import { anthropicEnv, plaidEnvironment } from "@/lib/env"
import {
  assertEnvironmentMatches,
  EnvironmentMismatchError,
} from "@/lib/environment"
import { rejectNonLocal } from "@/server/local-only"

/** What the header shows: model, how much data there is, how fresh it is, and any problems. */
export async function GET(request: Request) {
  const rejected = rejectNonLocal(request)
  if (rejected) return rejected

  const db = getDb()
  const [transactions, accounts, items] = await Promise.all([
    db.transaction.count(),
    db.account.count(),
    db.plaidItem.findMany({ select: { lastSyncedAt: true, status: true } }),
  ])
  const synced = items
    .map((i) => i.lastSyncedAt?.getTime())
    .filter((t): t is number => t != null)
  const { ANTHROPIC_MODEL: model, ANTHROPIC_EFFORT: effort } = anthropicEnv()
  const environmentError = await assertEnvironmentMatches(
    db,
    plaidEnvironment(),
  ).then(
    () => null,
    (err: unknown) => {
      if (err instanceof EnvironmentMismatchError) return err.message
      throw err
    },
  )

  return Response.json({
    model,
    effort,
    transactions,
    accounts,
    banks: items.length,
    banksNeedingReconnect: items.filter((i) => i.status === "needs_reconnect")
      .length,
    lastSyncedAt: synced.length
      ? new Date(Math.min(...synced)).toISOString()
      : null,
    environmentError,
  })
}
