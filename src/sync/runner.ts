import {
  assertEnvironmentMatches,
  EnvironmentMismatchError,
} from "@/lib/environment"
import { log, type SyncTrigger } from "@/lib/log"
import { syncAll, type ItemSyncResult, type SyncClient } from "./sync"
import type { PrismaClient } from "@/generated/prisma/client"
import type { PlaidEnvironment } from "@/lib/env"

// One sync at a time, shared by the Sync button and the sync_now tool
// (docs/milestone-3.md). In-memory is enough for one local user and one server process.

export interface SyncRun {
  /** `up_to_date`: skipped because the last sync was within the minimum interval. */
  status: "synced" | "up_to_date"
  /** The oldest bank's last successful sync, or null if a bank has never synced. */
  lastSyncedAt: string | null
  /** Per-bank results. Empty when `up_to_date`. */
  banks: ItemSyncResult[]
}

export interface SyncRunner {
  /**
   * Syncs every bank. Joins a sync that's already running instead of starting another.
   * With `minIntervalMs`, skips Plaid if the last sync was that recent.
   * Writes a `sync_run` log line for each sync it runs (not for one it joins).
   */
  sync(options: {
    trigger: SyncTrigger
    minIntervalMs?: number
  }): Promise<SyncRun>
  /** Runs `work` with no sync alongside it, such as connecting or removing a bank. */
  exclusive<T>(work: () => Promise<T>): Promise<T>
}

interface SyncRunnerOptions {
  db: PrismaClient
  plaid: SyncClient
  openToken: (sealed: string) => string
  environment: PlaidEnvironment
  now?: () => number
}

/** Writes a `sync_run` log line: counts and Plaid error codes only. */
export function logSyncRun(
  trigger: SyncTrigger,
  started: number,
  result:
    | { status: "synced" | "up_to_date"; banks: ItemSyncResult[] }
    | { status: "failed"; error: unknown },
) {
  const banks = result.status === "failed" ? [] : result.banks
  const countOutcome = (outcome: ItemSyncResult["outcome"]) =>
    banks.filter((b) => b.outcome === outcome).length
  const total = (key: "added" | "modified" | "removed" | "skipped") =>
    banks.reduce((sum, b) => sum + b[key], 0)
  log({
    event: "sync_run",
    trigger,
    status: result.status,
    ...(result.status === "failed"
      ? {
          errorKind:
            result.error instanceof EnvironmentMismatchError
              ? "environment_mismatch"
              : "internal",
        }
      : {}),
    banks: banks.length,
    synced: countOutcome("synced"),
    needsReconnect: countOutcome("needs_reconnect"),
    failed: countOutcome("failed"),
    waitingForPlaid: countOutcome("waiting_for_plaid"),
    added: total("added"),
    modified: total("modified"),
    removed: total("removed"),
    skipped: total("skipped"),
    errorCodes: [
      ...new Set(banks.flatMap((b) => (b.errorCode ? [b.errorCode] : []))),
    ],
    durationMs: Date.now() - started,
  })
}

export function createSyncRunner({
  db,
  plaid,
  openToken,
  environment,
  now = Date.now,
}: SyncRunnerOptions): SyncRunner {
  let queue: Promise<unknown> = Promise.resolve()
  let running: Promise<SyncRun> | null = null
  // When the last run finished, successful or not. A bank that keeps failing has
  // an old lastSyncedAt, so without this the throttle would never apply.
  let lastRunAt: number | null = null

  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work)
    queue = result.catch(() => undefined)
    return result
  }

  const oldestSync = async () => {
    const items = await db.plaidItem.findMany({
      select: { lastSyncedAt: true },
    })
    if (!items.length || items.some((i) => !i.lastSyncedAt)) return null
    return new Date(Math.min(...items.map((i) => i.lastSyncedAt!.getTime())))
  }

  const run = async (minIntervalMs: number): Promise<SyncRun> => {
    await assertEnvironmentMatches(db, environment)
    const oldest = await oldestSync()
    const lastAttempt = Math.max(lastRunAt ?? 0, oldest?.getTime() ?? 0)
    if (
      minIntervalMs > 0 &&
      lastAttempt &&
      now() - lastAttempt < minIntervalMs
    ) {
      return {
        status: "up_to_date",
        lastSyncedAt: oldest?.toISOString() ?? null,
        banks: [],
      }
    }
    try {
      const banks = await syncAll(db, plaid, openToken)
      return {
        status: "synced",
        lastSyncedAt: (await oldestSync())?.toISOString() ?? null,
        banks,
      }
    } finally {
      lastRunAt = now()
    }
  }

  const runAndLog = async (
    trigger: SyncTrigger,
    minIntervalMs: number,
  ): Promise<SyncRun> => {
    const started = Date.now()
    try {
      const result = await run(minIntervalMs)
      logSyncRun(trigger, started, result)
      return result
    } catch (error) {
      logSyncRun(trigger, started, { status: "failed", error })
      throw error
    }
  }

  return {
    sync({ trigger, minIntervalMs = 0 }) {
      running ??= exclusive(() => runAndLog(trigger, minIntervalMs)).finally(
        () => {
          running = null
        },
      )
      return running
    },
    exclusive,
  }
}
