import { TransactionsUpdateStatus } from "plaid"
import { extractPlaidErrorCode } from "@/lib/plaid"
import type {
  AccountBase,
  PlaidApi,
  RemovedTransaction,
  Transaction as PlaidTransaction,
} from "plaid"
import type { PrismaClient } from "@/generated/prisma/client"

// Copies Plaid data into Postgres with /transactions/sync (docs/decisions/0003).
// Safe to run repeatedly: the cursor means each run only applies what changed.

const MAX_RESTARTS = 3
const PAGE_SIZE = 500
// A brand-new Item can take a few seconds before transactions are ready.
const NEW_ITEM_SYNC_ATTEMPTS = 12
const NEW_ITEM_SYNC_RETRY_MS = 5_000

/** Plaid errors that the user fixes by signing in again through Link update mode. */
const RECONNECT_ERROR_CODES = new Set([
  "ITEM_LOGIN_REQUIRED",
  "ITEM_LOCKED",
  "INVALID_CREDENTIALS",
  "INVALID_MFA",
  "INSUFFICIENT_CREDENTIALS",
  "USER_SETUP_REQUIRED",
  "ACCESS_NOT_GRANTED",
  "NO_ACCOUNTS",
])

export type SyncClient = Pick<PlaidApi, "transactionsSync" | "accountsGet">

/** `plaid_items.status` */
export type ItemStatus = "ok" | "needs_reconnect"

/**
 * - `synced`: changes saved
 * - `waiting_for_plaid`: a new bank whose transactions Plaid hasn't prepared yet; nothing saved
 * - `needs_reconnect`: the user must sign in again (Link update mode)
 * - `failed`: another Plaid error, recorded on the bank; try again later
 */
export type SyncOutcome =
  "synced" | "waiting_for_plaid" | "needs_reconnect" | "failed"

export interface ItemSyncResult {
  /** `plaid_items.id` */
  bankId: string
  institution: string
  added: number
  modified: number
  removed: number
  accounts: number
  /** Transactions skipped because their account wasn't in the same response. */
  skipped: number
  outcome: SyncOutcome
  /** The Plaid error code, for `needs_reconnect` and `failed`. */
  errorCode?: string
}

interface SyncableItem {
  id: string
  institutionName: string | null
  syncCursor: string | null
}

const emptyResult = (
  item: SyncableItem,
  outcome: SyncOutcome,
  errorCode?: string,
): ItemSyncResult => ({
  bankId: item.id,
  institution: item.institutionName ?? "Unknown institution",
  added: 0,
  modified: 0,
  removed: 0,
  accounts: 0,
  skipped: 0,
  outcome,
  ...(errorCode ? { errorCode } : {}),
})

interface Pages {
  added: PlaidTransaction[]
  modified: PlaidTransaction[]
  removed: RemovedTransaction[]
  /** By account ID, from every page: each page lists only the accounts with transactions in it. */
  accounts: Map<string, AccountBase>
  cursor: string
  status: TransactionsUpdateStatus
}

/** Fetches every page from a starting cursor, restarting from that cursor if Plaid's data changes mid-way. */
async function fetchPages(
  plaid: SyncClient,
  accessToken: string,
  startCursor: string | undefined,
): Promise<Pages> {
  for (let attempt = 0; ; attempt++) {
    const pages: Pages = {
      added: [],
      modified: [],
      removed: [],
      accounts: new Map(),
      cursor: startCursor ?? "",
      status: TransactionsUpdateStatus.TransactionsUpdateStatusUnknown,
    }
    try {
      let cursor = startCursor
      let hasMore = true
      while (hasMore) {
        const { data } = await plaid.transactionsSync({
          access_token: accessToken,
          cursor,
          count: PAGE_SIZE,
          options: { include_personal_finance_category: true },
        })
        pages.added.push(...data.added)
        pages.modified.push(...data.modified)
        pages.removed.push(...data.removed)
        for (const a of data.accounts) pages.accounts.set(a.account_id, a)
        pages.status = data.transactions_update_status
        cursor = data.next_cursor
        hasMore = data.has_more
      }
      pages.cursor = cursor ?? ""
      return pages
    } catch (err) {
      // Plaid's docs: restart the whole loop from the first page's cursor.
      if (
        extractPlaidErrorCode(err) ===
          "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" &&
        attempt < MAX_RESTARTS
      )
        continue
      throw err
    }
  }
}

const toUtcDate = (isoDay: string) => new Date(`${isoDay}T00:00:00Z`)
const toDecimalString = (n: number | null | undefined) =>
  n == null ? null : n.toFixed(2)

function mapPlaidTransactionToFields(t: PlaidTransaction) {
  return {
    date: toUtcDate(t.date),
    authorizedDate: t.authorized_date ? toUtcDate(t.authorized_date) : null,
    name: t.name,
    merchantName: t.merchant_name ?? null,
    amount: t.amount.toFixed(2),
    currency: t.iso_currency_code ?? t.unofficial_currency_code ?? null,
    categoryPrimary: t.personal_finance_category?.primary ?? null,
    categoryDetailed: t.personal_finance_category?.detailed ?? null,
    paymentChannel: t.payment_channel ?? null,
    pending: t.pending,
  }
}

function mapPlaidAccountToFields(a: AccountBase) {
  return {
    name: a.name,
    officialName: a.official_name ?? null,
    type: a.type,
    subtype: a.subtype ?? null,
    mask: a.mask ?? null,
    currentBalance: toDecimalString(a.balances.current),
    availableBalance: toDecimalString(a.balances.available),
    creditLimit: toDecimalString(a.balances.limit),
    currency:
      a.balances.iso_currency_code ??
      a.balances.unofficial_currency_code ??
      null,
  }
}

/**
 * Syncs one bank. With no saved cursor (the first sync, or a reset to resync from
 * scratch), Plaid sends the bank's whole history, so transactions Plaid no longer
 * has are deleted afterwards.
 */
export async function syncItem(
  db: PrismaClient,
  plaid: SyncClient,
  item: SyncableItem,
  accessToken: string,
): Promise<ItemSyncResult> {
  const isFullSync = !item.syncCursor
  const startedAt = new Date()
  const pages = await fetchPages(
    plaid,
    accessToken,
    item.syncCursor ?? undefined,
  )

  const isEmpty =
    !pages.added.length && !pages.modified.length && !pages.removed.length
  if (
    isFullSync &&
    isEmpty &&
    pages.status === TransactionsUpdateStatus.NotReady
  ) {
    return emptyResult(item, "waiting_for_plaid")
  }

  // /transactions/sync only lists accounts with transactions in each response, so
  // quiet accounts would never get a new balance. /accounts/get has every account.
  const { data: accountsData } = await plaid.accountsGet({
    access_token: accessToken,
  })
  const accounts = new Map(pages.accounts)
  for (const a of accountsData.accounts) accounts.set(a.account_id, a)

  const counts = { added: 0, modified: 0, skipped: 0 }
  // Everything lands in one database transaction with the new cursor, so a
  // failure part-way leaves the old cursor and the next run redoes the work.
  await db.$transaction(
    async (tx) => {
      // Accounts saved by earlier syncs, so a transaction is never dropped just
      // because its account wasn't in this response.
      const saved = await tx.account.findMany({
        where: { plaidItemId: item.id },
        select: { id: true, plaidAccountId: true },
      })
      const accountIds = new Map(saved.map((a) => [a.plaidAccountId, a.id]))
      for (const a of accounts.values()) {
        const fields = mapPlaidAccountToFields(a)
        const row = await tx.account.upsert({
          where: { plaidAccountId: a.account_id },
          create: {
            plaidItemId: item.id,
            plaidAccountId: a.account_id,
            ...fields,
          },
          update: fields,
          select: { id: true },
        })
        accountIds.set(a.account_id, row.id)
      }

      const changes = [
        ...pages.added.map((t) => ({ t, kind: "added" as const })),
        ...pages.modified.map((t) => ({ t, kind: "modified" as const })),
      ]
      for (const { t, kind } of changes) {
        const accountId = accountIds.get(t.account_id)
        if (!accountId) {
          counts.skipped++
          continue
        }
        const fields = mapPlaidTransactionToFields(t)
        await tx.transaction.upsert({
          where: { plaidTransactionId: t.transaction_id },
          create: {
            plaidTransactionId: t.transaction_id,
            accountId,
            ...fields,
          },
          update: { accountId, ...fields },
        })
        counts[kind]++
      }

      const removedIds = pages.removed
        .map((r) => r.transaction_id)
        .filter((id): id is string => Boolean(id))
      if (removedIds.length)
        await tx.transaction.deleteMany({
          where: { plaidTransactionId: { in: removedIds } },
        })

      // A full sync rewrote every transaction Plaid still has (upserts set updatedAt),
      // so anything for this bank older than the sync is gone at Plaid. Only once
      // Plaid has sent the whole history: before that it sends recent transactions only.
      if (
        isFullSync &&
        pages.status === TransactionsUpdateStatus.HistoricalUpdateComplete
      ) {
        await tx.transaction.deleteMany({
          where: {
            account: { plaidItemId: item.id },
            updatedAt: { lt: startedAt },
          },
        })
      }

      await tx.plaidItem.update({
        where: { id: item.id },
        data: {
          syncCursor: pages.cursor,
          lastSyncedAt: new Date(),
          status: "ok" satisfies ItemStatus,
          lastErrorCode: null,
        },
      })
    },
    { timeout: 120_000 },
  )

  return {
    bankId: item.id,
    institution: item.institutionName ?? "Unknown institution",
    added: counts.added,
    modified: counts.modified,
    removed: pages.removed.length,
    accounts: accounts.size,
    skipped: counts.skipped,
    outcome: "synced",
  }
}

/**
 * Like syncItem, but a Plaid error is recorded on the bank and returned instead of
 * thrown, so one broken bank doesn't stop the others. Other errors still throw.
 */
export async function syncItemRecordingErrors(
  db: PrismaClient,
  plaid: SyncClient,
  item: SyncableItem,
  accessToken: string,
): Promise<ItemSyncResult> {
  try {
    return await syncItem(db, plaid, item, accessToken)
  } catch (err) {
    const code = extractPlaidErrorCode(err)
    if (!code) throw err
    const needsReconnect = RECONNECT_ERROR_CODES.has(code)
    await db.plaidItem.update({
      where: { id: item.id },
      data: {
        lastErrorCode: code,
        ...(needsReconnect
          ? { status: "needs_reconnect" satisfies ItemStatus }
          : {}),
      },
    })
    return emptyResult(
      item,
      needsReconnect ? "needs_reconnect" : "failed",
      code,
    )
  }
}

/** First sync of a newly connected bank, retrying while Plaid prepares its transactions. */
export async function syncNewItem(
  db: PrismaClient,
  plaid: SyncClient,
  item: SyncableItem,
  accessToken: string,
  { attempts = NEW_ITEM_SYNC_ATTEMPTS, retryMs = NEW_ITEM_SYNC_RETRY_MS } = {},
): Promise<ItemSyncResult> {
  for (let attempt = 1; ; attempt++) {
    const result = await syncItemRecordingErrors(db, plaid, item, accessToken)
    if (result.outcome !== "waiting_for_plaid" || attempt >= attempts)
      return result
    await new Promise((resolve) => setTimeout(resolve, retryMs))
  }
}

/** Syncs every connected Item, carrying on past banks that fail. */
export async function syncAll(
  db: PrismaClient,
  plaid: SyncClient,
  openToken: (sealed: string) => string,
): Promise<ItemSyncResult[]> {
  const items = await db.plaidItem.findMany({ orderBy: { createdAt: "asc" } })
  const results: ItemSyncResult[] = []
  for (const item of items) {
    results.push(
      await syncItemRecordingErrors(
        db,
        plaid,
        item,
        openToken(item.accessTokenEncrypted),
      ),
    )
  }
  return results
}
