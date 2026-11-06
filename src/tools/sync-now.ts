import { EnvironmentMismatchError } from "@/lib/environment"
import type { ToolContext } from "./handlers"
import type { SyncOutcome } from "@/sync/sync"

// The one tool that calls Plaid (docs/decisions/0013). It returns counts and
// statuses only; Claude reads the new data with the other tools afterwards.

const MIN_INTERVAL_MS = 5 * 60_000
const RECONNECT_HINT =
  "The user needs to sign in to this bank again: Banks panel > Reconnect."

type BankStatus = SyncOutcome | "not_synced_now"

interface BankReport {
  bank: string
  status: BankStatus
  added?: number
  updated?: number
  removed?: number
  last_synced: string | null
  note?: string
}

const NOTES: Partial<Record<BankStatus, string>> = {
  needs_reconnect: RECONNECT_HINT,
  waiting_for_plaid:
    "Plaid is still preparing this bank's transactions. Try again in a minute.",
  failed: "This bank's sync failed. Its data is as of last_synced.",
}

export async function syncNow({ db, sync }: ToolContext) {
  if (!sync) {
    return {
      status: "unavailable",
      new_transactions: 0,
      message: "Syncing isn't available here. Answer from the existing data.",
    }
  }

  let run
  try {
    run = await sync.sync({ trigger: "tool", minIntervalMs: MIN_INTERVAL_MS })
  } catch (err) {
    if (err instanceof EnvironmentMismatchError) {
      return {
        status: "refused",
        new_transactions: 0,
        message:
          "The app's Plaid settings don't match its database, so syncing is disabled. Tell the user to check the server log.",
      }
    }
    throw err
  }

  const items = await db.plaidItem.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      institutionName: true,
      status: true,
      lastSyncedAt: true,
    },
  })
  const banks = items.map((item): BankReport => {
    const result = run.banks.find((r) => r.bankId === item.id)
    const status: BankStatus =
      result?.outcome ??
      (item.status === "needs_reconnect" ? "needs_reconnect" : "not_synced_now")
    const counts =
      result?.outcome === "synced"
        ? {
            added: result.added,
            updated: result.modified,
            removed: result.removed,
          }
        : {}
    const note = NOTES[status]
    return {
      bank: item.institutionName ?? "Unknown institution",
      status,
      ...counts,
      last_synced: item.lastSyncedAt?.toISOString() ?? null,
      ...(note ? { note } : {}),
    }
  })

  return {
    status: run.status,
    ...(run.status === "up_to_date"
      ? {
          message:
            "Synced within the last 5 minutes, so Plaid wasn't called again.",
        }
      : {}),
    new_transactions: banks.reduce((sum, b) => sum + (b.added ?? 0), 0),
    data_as_of: run.lastSyncedAt,
    banks,
  }
}
