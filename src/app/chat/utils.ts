import { AUTO_SYNC_AFTER_MS, CONVERSATION_URL_PARAM } from "./constants"
import type { ItemSyncResult, SyncRun } from "./types"

export interface Notice {
  /** `progress` is shown while something runs and can't be dismissed. */
  tone: "progress" | "success" | "warning" | "danger"
  text: string
}

export const formatSyncedAt = (iso: string | null) => {
  if (!iso) return "never synced"
  const when = new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
  return `synced ${when}`
}

export const readUrlConversation = () =>
  new URL(window.location.href).searchParams.get(CONVERSATION_URL_PARAM)

/** Keeps the open conversation in the URL so a reload brings it back. */
export const writeUrlConversation = (id: string | null) => {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set(CONVERSATION_URL_PARAM, id)
  else url.searchParams.delete(CONVERSATION_URL_PARAM)
  window.history.replaceState(null, "", url)
}

export const isSyncStale = (lastSyncedAt: string | null, now = Date.now()) =>
  !lastSyncedAt || now - new Date(lastSyncedAt).getTime() > AUTO_SYNC_AFTER_MS

export const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`

const describeProblem = (result: ItemSyncResult) => {
  switch (result.outcome) {
    case "needs_reconnect":
      return `${result.institution} needs you to sign in again: use Reconnect.`
    case "failed":
      return `${result.institution} didn't sync (Plaid error ${result.errorCode}). Try again later.`
    case "waiting_for_plaid":
      return `Plaid is still preparing ${result.institution}'s transactions. Sync again in a minute.`
    default:
      return null
  }
}

export const describeSyncRun = (run: SyncRun): Notice => {
  const problems = run.banks
    .map(describeProblem)
    .filter((p): p is string => p !== null)
  if (problems.length) return { tone: "warning", text: problems.join(" ") }
  if (run.status === "up_to_date")
    return { tone: "success", text: "Already up to date." }
  const added = run.banks.reduce((sum, b) => sum + b.added, 0)
  return {
    tone: "success",
    text: `Synced ${plural(run.banks.length, "bank")}: ${plural(added, "new transaction")}.`,
  }
}

export const describeFirstSync = (result: ItemSyncResult): Notice =>
  result.outcome === "synced"
    ? {
        tone: "success",
        text: `Connected ${result.institution}: ${plural(result.accounts, "account")}, ${plural(result.added, "transaction")}.`,
      }
    : {
        tone: "warning",
        text: describeProblem(result) ?? `Connected ${result.institution}.`,
      }
