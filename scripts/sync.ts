// Pulls new and changed transactions and current balances for every connected bank.
// Usage: npm run sync [-- --full]
//   --full  resync each bank's whole history from Plaid, restoring anything an
//           earlier sync missed (docs/milestone-5.md). Safe to repeat.
import "@/lib/load-env"
import { disconnectDb, getDb } from "@/lib/db"
import { plaidEnv } from "@/lib/env"
import {
  createPlaidClient,
  openAccessToken,
  extractPlaidErrorCode,
} from "@/lib/plaid"
import { createSyncRunner } from "@/sync/runner"
import type { ItemSyncResult } from "@/sync/sync"

const describeResult = (r: ItemSyncResult) => {
  switch (r.outcome) {
    case "synced":
      return `${r.added} added, ${r.modified} updated, ${r.removed} removed across ${r.accounts} accounts.`
    case "waiting_for_plaid":
      return "Plaid is still preparing transactions; try again shortly."
    case "needs_reconnect":
      return `needs reconnecting (${r.errorCode}). Use Reconnect in the app's Banks panel.`
    case "failed":
      return `sync failed (Plaid error ${r.errorCode}); try again later.`
  }
}

const isFullResync = process.argv.includes("--full")

async function main() {
  if (isFullResync) {
    // No cursor means Plaid sends every transaction again; see syncItem.
    const { count } = await getDb().plaidItem.updateMany({
      data: { syncCursor: null },
    })
    console.log(
      `Resyncing the full history of ${count} bank${count === 1 ? "" : "s"}...`,
    )
  }
  // Through the runner, so the environment check and the sync_run log line are the same as the app's.
  const runner = createSyncRunner({
    db: getDb(),
    plaid: createPlaidClient(),
    openToken: openAccessToken,
    environment: plaidEnv().PLAID_ENV,
  })
  const { banks: results } = await runner.sync({ trigger: "script" })
  if (!results.length) {
    console.log(
      "No banks connected yet. Connect one in the app, or run `npm run plaid:sandbox` for Sandbox data.",
    )
    return
  }
  for (const r of results) console.log(`${r.institution}: ${describeResult(r)}`)
  if (
    results.some(
      (r) => r.outcome === "needs_reconnect" || r.outcome === "failed",
    )
  )
    process.exitCode = 1
}

main()
  .catch((err) => {
    const code = extractPlaidErrorCode(err)
    console.error(
      code ? `Plaid error: ${code}` : err instanceof Error ? err.message : err,
    )
    process.exitCode = 1
  })
  .finally(disconnectDb)
