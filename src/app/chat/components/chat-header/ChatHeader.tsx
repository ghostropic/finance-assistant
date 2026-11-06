import { formatNumber } from "@/chat/format"
import { formatSyncedAt } from "../../utils"
import type { ReactNode } from "react"
import type { Status } from "../../types"

interface Props {
  status: Status | null
  /** Shown first, before the title. Used for the narrow-screen conversation menu. */
  menu?: ReactNode
  /** Shown at the end of the header. */
  actions?: ReactNode
}

export const ChatHeader = ({ status, menu, actions }: Props) => {
  const summary = status
    ? `${status.model} · ${formatNumber(status.transactions)} transactions in ${status.accounts} accounts · ${formatSyncedAt(status.lastSyncedAt)}`
    : null
  const hasSummary = summary !== null

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-0.5 border-b border-border px-6 py-3.5">
      {menu}
      <h1 className="text-base font-semibold whitespace-nowrap">
        Finance Assistant
      </h1>
      {hasSummary && <p className="text-sm text-muted">{summary}</p>}
      {actions}
    </header>
  )
}
