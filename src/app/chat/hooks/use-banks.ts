"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  connectBank,
  fetchBanks,
  fetchStatus,
  removeBank,
  runSync,
} from "../api"
import {
  describeFirstSync,
  describeSyncRun,
  isSyncStale,
  type Notice,
} from "../utils"
import { usePlaidLinkFlow } from "./use-plaid-link-flow"
import type { BankSummary } from "../types"

interface Options {
  /** Called after anything that changes the data, so the header refreshes. */
  onDataChanged: () => void
}

const errorNotice = (err: unknown): Notice => ({
  tone: "danger",
  text: err instanceof Error ? err.message : String(err),
})

/** Connected banks: listing, syncing, connecting, repairing and removing (docs/milestone-3.md). */
export const useBanks = ({ onDataChanged }: Options) => {
  const hasAutoSyncedRef = useRef(false)

  const [banks, setBanks] = useState<BankSummary[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  const loadBanks = useCallback(async () => {
    try {
      setBanks(await fetchBanks())
    } catch (err) {
      setNotice(errorNotice(err))
    }
  }, [])

  const refresh = useCallback(async () => {
    onDataChanged()
    await loadBanks()
  }, [onDataChanged, loadBanks])

  const runSyncAndReport = useCallback(
    async (trigger: Parameters<typeof runSync>[0]) => {
      setIsSyncing(true)
      setNotice(null)
      try {
        setNotice(describeSyncRun(await runSync(trigger)))
      } catch (err) {
        setNotice(errorNotice(err))
      } finally {
        setIsSyncing(false)
        void refresh()
      }
    },
    [refresh],
  )

  // Takes no arguments: buttons call it with their press event.
  const sync = useCallback(() => runSyncAndReport("button"), [runSyncAndReport])

  const connect = useCallback(
    async (publicToken: string | null, institutionId?: string) => {
      if (!publicToken) {
        setNotice({
          tone: "danger",
          text: "Plaid Link finished without a token. Try connecting again.",
        })
        return
      }
      setIsConnecting(true)
      // The first sync runs before the server replies, so this can take a while (up to a minute).
      setNotice({
        tone: "progress",
        text: "Connecting your bank and loading its transactions…",
      })
      try {
        const { firstSync } = await connectBank(publicToken, institutionId)
        setNotice(describeFirstSync(firstSync))
      } catch (err) {
        setNotice(errorNotice(err))
      } finally {
        setIsConnecting(false)
        void refresh()
      }
    },
    [refresh],
  )

  const remove = useCallback(
    async (bankId: string) => {
      setNotice(null)
      try {
        await removeBank(bankId)
      } catch (err) {
        setNotice(errorNotice(err))
      } finally {
        void refresh()
      }
    },
    [refresh],
  )

  const handleLinked = (
    publicToken: string | null,
    bankId: string | undefined,
    institutionId: string | undefined,
  ) => {
    // Update mode repairs the bank's login; a sync clears its status.
    if (bankId) void runSyncAndReport("reconnect")
    else void connect(publicToken, institutionId)
  }

  const link = usePlaidLinkFlow({
    // React Aria makes everything outside an open modal inert, Link's iframe included.
    onOpen: () => setIsOpen(false),
    onSuccess: handleLinked,
    onError: (text) => setNotice({ tone: "danger", text }),
  })

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open)
      if (open) void loadBanks()
    },
    [loadBanks],
  )

  const openBanks = useCallback(
    () => handleOpenChange(true),
    [handleOpenChange],
  )

  const dismissNotice = useCallback(() => setNotice(null), [])

  const syncIfStale = useCallback(async () => {
    const status = await fetchStatus().catch(() => null)
    if (
      status &&
      status.banks > 0 &&
      !status.environmentError &&
      isSyncStale(status.lastSyncedAt)
    )
      await runSyncAndReport("page_open")
  }, [runSyncAndReport])

  // Sync once when the page opens if the data is old (there are no webhooks; docs/milestone-3.md).
  // The ref stops React's development double-run from syncing twice.
  useEffect(() => {
    if (hasAutoSyncedRef.current) return
    hasAutoSyncedRef.current = true
    void syncIfStale()
  }, [syncIfStale])

  return {
    banks,
    isOpen,
    handleOpenChange,
    openBanks,
    isSyncing,
    isConnecting,
    notice,
    dismissNotice,
    sync,
    remove,
    /** Opens Plaid Link for a new bank, or with a bank ID to reconnect that bank. */
    startLink: link.start,
    isLinkingNewBank: link.isLinkingNewBank,
    linkingBankId: link.linkingBankId,
  }
}
