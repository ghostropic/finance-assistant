import { CountryCode, Products } from "plaid"
import { assertEnvironmentMatches } from "@/lib/environment"
import { extractPlaidErrorCode } from "@/lib/plaid"
import { logSyncRun } from "@/sync/runner"
import { syncNewItem, type ItemStatus, type ItemSyncResult } from "@/sync/sync"
import type { PlaidApi } from "plaid"
import type { PrismaClient } from "@/generated/prisma/client"
import type { PlaidEnvironment } from "@/lib/env"
import type { SyncRunner } from "@/sync/runner"

// Connecting, repairing and removing banks through Plaid Link (docs/milestone-3.md).
// Access tokens stay on the server: the browser only ever holds link and public tokens.

const CLIENT_NAME = "Finance Assistant"
// Plaid wants an ID per end user; this app has one.
const CLIENT_USER_ID = "local-user"
// Plaid's default is 90 days of history; 730 is the maximum, and it can't be raised later.
const DAYS_OF_HISTORY = 730
/** Plaid errors from /item/remove that mean the Item is already gone there. */
const ITEM_GONE_ERROR_CODES = new Set([
  "ITEM_NOT_FOUND",
  "INVALID_ACCESS_TOKEN",
])

export type BanksPlaidClient = Pick<
  PlaidApi,
  | "linkTokenCreate"
  | "itemPublicTokenExchange"
  | "itemGet"
  | "itemRemove"
  | "transactionsSync"
  | "accountsGet"
>

export interface BanksDeps {
  db: PrismaClient
  plaid: BanksPlaidClient
  environment: PlaidEnvironment
  sealToken: (token: string) => string
  openToken: (sealed: string) => string
  runner: SyncRunner
}

/** What the browser sees about a connected bank. No Plaid IDs or tokens. */
export interface BankSummary {
  id: string
  institution: string
  status: ItemStatus
  lastErrorCode: string | null
  lastSyncedAt: string | null
  transactionCount: number
  accounts: {
    name: string
    mask: string | null
    type: string
    subtype: string | null
  }[]
}

export class DuplicateBankError extends Error {}

const duplicateBankError = (institutionName: string | null) =>
  new DuplicateBankError(
    `${institutionName ?? "This bank"} is already connected. If it isn't syncing, use Reconnect.`,
  )
export class BankNotFoundError extends Error {}

/** A link token for connecting a new bank, or, with `bankId`, for repairing one (update mode). */
export async function createLinkToken(
  { db, plaid, openToken }: BanksDeps,
  bankId?: string,
): Promise<string> {
  const base = {
    client_name: CLIENT_NAME,
    user: { client_user_id: CLIENT_USER_ID },
    country_codes: [CountryCode.Us],
    language: "en",
  }
  if (bankId) {
    const item = await db.plaidItem.findUnique({ where: { id: bankId } })
    if (!item) throw new BankNotFoundError("That bank isn't connected.")
    const { data } = await plaid.linkTokenCreate({
      ...base,
      access_token: openToken(item.accessTokenEncrypted),
    })
    return data.link_token
  }
  // Read-only product only (docs/security.md).
  const { data } = await plaid.linkTokenCreate({
    ...base,
    products: [Products.Transactions],
    transactions: { days_requested: DAYS_OF_HISTORY },
  })
  return data.link_token
}

/**
 * Exchanges Link's public token, stores the bank and runs its first sync.
 * `institutionIdHint` is the institution Link reported in the browser. Plaid's
 * guidance is not to exchange the token of a duplicate, since that creates the
 * duplicate Item (docs/milestone-4.md). The hint comes from the browser, so the
 * check after the exchange stays as a backstop.
 */
export async function connectBank(
  deps: BanksDeps,
  publicToken: string,
  institutionIdHint?: string,
): Promise<{ bankId: string; firstSync: ItemSyncResult }> {
  const { db, plaid, environment, runner } = deps
  return runner.exclusive(async () => {
    await assertEnvironmentMatches(db, environment)
    const hinted = institutionIdHint
      ? await db.plaidItem.findFirst({
          where: { institutionId: institutionIdHint },
        })
      : null
    if (hinted) throw duplicateBankError(hinted.institutionName)

    const { data: exchanged } = await plaid.itemPublicTokenExchange({
      public_token: publicToken,
    })
    // Look the institution up here rather than trusting what the browser reports.
    const { data } = await plaid.itemGet({
      access_token: exchanged.access_token,
    })
    const institutionId = data.item.institution_id ?? null

    const existing = institutionId
      ? await db.plaidItem.findFirst({ where: { institutionId } })
      : null
    if (existing) {
      // Plaid bills per Item, so the duplicate is removed straight away.
      await plaid.itemRemove({ access_token: exchanged.access_token })
      throw duplicateBankError(existing.institutionName)
    }

    const name = data.item.institution_name ?? "Unknown institution"
    const item = await db.plaidItem.create({
      data: {
        plaidItemId: exchanged.item_id,
        environment,
        institutionId,
        institutionName: environment === "sandbox" ? `${name} (Sandbox)` : name,
        accessTokenEncrypted: deps.sealToken(exchanged.access_token),
      },
    })
    const started = Date.now()
    const firstSync = await syncNewItem(db, plaid, item, exchanged.access_token)
    logSyncRun("connect", started, { status: "synced", banks: [firstSync] })
    return { bankId: item.id, firstSync }
  })
}

/** Removes the Item at Plaid, then deletes the bank with its accounts and transactions. False if there's no such bank. */
export async function removeBank(
  { db, plaid, environment, openToken, runner }: BanksDeps,
  bankId: string,
): Promise<boolean> {
  return runner.exclusive(async () => {
    await assertEnvironmentMatches(db, environment)
    const item = await db.plaidItem.findUnique({ where: { id: bankId } })
    if (!item) return false
    try {
      await plaid.itemRemove({
        access_token: openToken(item.accessTokenEncrypted),
      })
    } catch (err) {
      if (!ITEM_GONE_ERROR_CODES.has(extractPlaidErrorCode(err) ?? ""))
        throw err
    }
    await db.plaidItem.delete({ where: { id: item.id } })
    return true
  })
}

export async function listBanks(db: PrismaClient): Promise<BankSummary[]> {
  const items = await db.plaidItem.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      accounts: {
        orderBy: [{ type: "asc" }, { name: "asc" }],
        select: {
          name: true,
          mask: true,
          type: true,
          subtype: true,
          _count: { select: { transactions: true } },
        },
      },
    },
  })
  return items.map((item) => ({
    id: item.id,
    institution: item.institutionName ?? "Unknown institution",
    status: item.status as ItemStatus,
    lastErrorCode: item.lastErrorCode,
    lastSyncedAt: item.lastSyncedAt?.toISOString() ?? null,
    transactionCount: item.accounts.reduce(
      (sum, a) => sum + a._count.transactions,
      0,
    ),
    accounts: item.accounts.map(({ name, mask, type, subtype }) => ({
      name,
      mask,
      type,
      subtype,
    })),
  }))
}
