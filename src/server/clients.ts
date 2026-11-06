import Anthropic from "@anthropic-ai/sdk"
import { getDb } from "@/lib/db"
import { plaidEnv } from "@/lib/env"
import {
  createPlaidClient,
  openAccessToken,
  sealAccessToken,
} from "@/lib/plaid"
import { createSyncRunner, type SyncRunner } from "@/sync/runner"
import type { BanksDeps } from "./banks"
import type { PlaidApi } from "plaid"

// One of each per server process. Kept on globalThis because Next.js can load a
// module once per route bundle, and the sync runner's lock only works if every
// route shares the same runner.
const holder = globalThis as unknown as {
  __financeAnthropic?: Anthropic
  __financePlaid?: PlaidApi
  __financeSyncRunner?: SyncRunner
}

// The SDK reads ANTHROPIC_API_KEY (or another credential source) itself.
export function getAnthropic(): Anthropic {
  holder.__financeAnthropic ??= new Anthropic()
  return holder.__financeAnthropic
}

export function getPlaid(): PlaidApi {
  holder.__financePlaid ??= createPlaidClient()
  return holder.__financePlaid
}

export function getSyncRunner(): SyncRunner {
  holder.__financeSyncRunner ??= createSyncRunner({
    db: getDb(),
    plaid: getPlaid(),
    openToken: openAccessToken,
    environment: plaidEnv().PLAID_ENV,
  })
  return holder.__financeSyncRunner
}

/** The sync runner, or undefined when Plaid isn't configured (chat still works without it). */
export function getSyncRunnerIfConfigured(): SyncRunner | undefined {
  try {
    return getSyncRunner()
  } catch {
    return undefined
  }
}

export function getBanksDeps(): BanksDeps {
  return {
    db: getDb(),
    plaid: getPlaid(),
    environment: plaidEnv().PLAID_ENV,
    sealToken: sealAccessToken,
    openToken: openAccessToken,
    runner: getSyncRunner(),
  }
}
