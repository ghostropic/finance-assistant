import { Button } from "@heroui/react"
import { plural } from "../../utils"
import type { ReactNode } from "react"

interface Props {
  isSyncing: boolean
  canSync: boolean
  banksNeedingReconnect: number
  onSync: () => void
  onOpenBanks: () => void
  /** The Banks button with its panel. */
  banksDrawer: ReactNode
}

export const HeaderActions = ({
  isSyncing,
  canSync,
  banksNeedingReconnect,
  onSync,
  onOpenBanks,
  banksDrawer,
}: Props) => {
  const hasReconnectWarning = banksNeedingReconnect > 0
  const syncLabel = isSyncing ? "Syncing…" : "Sync"
  const warning = `${plural(banksNeedingReconnect, "bank")} to reconnect`

  return (
    <div className="ml-auto flex items-center gap-2">
      {hasReconnectWarning && (
        <Button
          variant="ghost"
          size="sm"
          className="text-warning"
          onPress={onOpenBanks}
        >
          {warning}
        </Button>
      )}
      <Button
        variant="tertiary"
        size="sm"
        isPending={isSyncing}
        isDisabled={!canSync}
        onPress={onSync}
      >
        {syncLabel}
      </Button>
      {banksDrawer}
    </div>
  )
}
