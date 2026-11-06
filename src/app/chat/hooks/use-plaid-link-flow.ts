"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  usePlaidLink,
  type PlaidLinkError,
  type PlaidLinkOnExit,
  type PlaidLinkOnSuccess,
} from "react-plaid-link"
import { createLinkToken } from "../api"

const NEW_BANK = "new"

interface Callbacks {
  /** Link is about to open. */
  onOpen: () => void
  /**
   * `bankId` is set for update mode, where the public token is null and needs no exchange.
   * `institutionId` is the institution Link reports, if any.
   */
  onSuccess: (
    publicToken: string | null,
    bankId: string | undefined,
    institutionId: string | undefined,
  ) => void
  onError: (message: string) => void
}

const describeLinkError = (err: PlaidLinkError) =>
  err.display_message || err.error_message || "Plaid Link closed with an error."

/**
 * One Plaid Link session at a time, for connecting a new bank or repairing one.
 * Use it from a component that stays mounted while Link is open: unmounting
 * usePlaidLink closes Link. Link loads from Plaid's CDN, as Plaid requires.
 */
export const usePlaidLinkFlow = (callbacks: Callbacks) => {
  const callbacksRef = useRef(callbacks)
  // NEW_BANK or a bank ID while Link is starting or open. A ref too, so Link's
  // callbacks stay stable: react-plaid-link rebuilds Link when they change.
  const targetRef = useRef<string | null>(null)

  const [target, setTarget] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)

  const finish = useCallback(() => {
    targetRef.current = null
    setTarget(null)
    setToken(null)
  }, [])

  const handleSuccess = useCallback<PlaidLinkOnSuccess>(
    (publicToken, metadata) => {
      const current = targetRef.current
      finish()
      const bankId =
        current === NEW_BANK || current === null ? undefined : current
      callbacksRef.current.onSuccess(
        publicToken,
        bankId,
        metadata?.institution?.institution_id ?? undefined,
      )
    },
    [finish],
  )

  const handleExit = useCallback<PlaidLinkOnExit>(
    (err) => {
      finish()
      if (err) callbacksRef.current.onError(describeLinkError(err))
    },
    [finish],
  )

  const { open, ready } = usePlaidLink({
    token,
    onSuccess: handleSuccess,
    onExit: handleExit,
  })

  const start = useCallback(
    async (bankId?: string) => {
      if (targetRef.current) return
      const next = bankId ?? NEW_BANK
      targetRef.current = next
      setTarget(next)
      try {
        setToken(await createLinkToken(bankId))
      } catch (err) {
        finish()
        callbacksRef.current.onError(
          err instanceof Error ? err.message : String(err),
        )
      }
    },
    [finish],
  )

  const isLinkingNewBank = target === NEW_BANK
  const linkingBankId = target === NEW_BANK ? null : target

  useEffect(() => {
    callbacksRef.current = callbacks
  })

  useEffect(() => {
    if (!token || !ready) return
    callbacksRef.current.onOpen()
    open()
  }, [token, ready, open])

  return { start, isLinkingNewBank, linkingBankId }
}
