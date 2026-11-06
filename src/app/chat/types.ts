import type { Turn } from "@/chat/display"

export type { BankSummary } from "@/server/banks"
export type { SyncRun } from "@/sync/runner"
export type { ItemSyncResult } from "@/sync/sync"

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: string
}

export interface ConversationDetail {
  id: string
  title: string
  turns: Turn[]
}

export interface Status {
  model: string
  effort: string
  transactions: number
  accounts: number
  banks: number
  banksNeedingReconnect: number
  lastSyncedAt: string | null
  /** Set when PLAID_ENV doesn't match the banks in the database; syncing and connecting are refused. */
  environmentError: string | null
}

export interface ChatRequest {
  message: string
  conversationId?: string
}
