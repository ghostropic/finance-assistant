// Creates a fake bank connection in Plaid Sandbox, stores it, and runs the first sync.
// Usage: npm run plaid:sandbox [-- --user user_transactions_dynamic]
import "@/lib/load-env"
import { CountryCode, Products } from "plaid"
import { disconnectDb, getDb } from "@/lib/db"
import { plaidEnv } from "@/lib/env"
import { assertEnvironmentMatches } from "@/lib/environment"
import {
  createPlaidClient,
  extractPlaidErrorCode,
  sealAccessToken,
} from "@/lib/plaid"
import { syncNewItem } from "@/sync/sync"

const FIRST_PLATYPUS_BANK_ID = "ins_109508"

const userFlag = process.argv.indexOf("--user")
const sandboxUser = userFlag > -1 ? process.argv[userFlag + 1] : undefined

async function main() {
  if (plaidEnv().PLAID_ENV !== "sandbox") {
    throw new Error("This script only runs with PLAID_ENV=sandbox.")
  }
  const plaid = createPlaidClient()
  const db = getDb()
  await assertEnvironmentMatches(db, "sandbox")

  // Read-only product only (docs/security.md).
  const { data: created } = await plaid.sandboxPublicTokenCreate({
    institution_id: FIRST_PLATYPUS_BANK_ID,
    initial_products: [Products.Transactions],
    options: sandboxUser
      ? { override_username: sandboxUser, override_password: "pass_good" }
      : undefined,
  })
  const { data: exchanged } = await plaid.itemPublicTokenExchange({
    public_token: created.public_token,
  })
  const { data: institution } = await plaid.institutionsGetById({
    institution_id: FIRST_PLATYPUS_BANK_ID,
    country_codes: [CountryCode.Us],
  })

  const item = await db.plaidItem.create({
    data: {
      plaidItemId: exchanged.item_id,
      environment: "sandbox",
      institutionId: FIRST_PLATYPUS_BANK_ID,
      institutionName: `${institution.institution.name} (Sandbox)`,
      accessTokenEncrypted: sealAccessToken(exchanged.access_token),
    },
  })
  console.log(
    `Connected ${item.institutionName}. Waiting for Plaid to prepare transactions...`,
  )

  const result = await syncNewItem(db, plaid, item, exchanged.access_token)
  if (result.outcome === "synced")
    console.log(
      `Synced ${result.accounts} accounts and ${result.added} transactions.`,
    )
  else if (result.outcome === "waiting_for_plaid")
    console.log(
      "Plaid hasn't prepared transactions yet. Run `npm run sync` in a minute.",
    )
  else
    console.log(
      `The first sync failed: Plaid error ${result.errorCode}. Run \`npm run sync\` to try again.`,
    )
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
