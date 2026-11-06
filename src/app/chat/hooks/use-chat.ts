"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { applyEvent, type ChatEvent, type Turn } from "@/chat/display"
import {
  deleteConversation,
  fetchConversation,
  fetchConversations,
  fetchStatus,
  streamChat,
} from "../api"
import { readUrlConversation, writeUrlConversation } from "../utils"
import type { ConversationSummary, Status } from "../types"

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : String(err)

const replaceLastTurn = (turns: Turn[], update: (turn: Turn) => Turn) =>
  turns.length
    ? [...turns.slice(0, -1), update(turns[turns.length - 1])]
    : turns

const markUnfinished = (turn: Turn, fallback: Turn): Turn =>
  turn.status === "streaming" ? fallback : turn

export const useChat = () => {
  const abortRef = useRef<AbortController | null>(null)

  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const updateLastTurn = useCallback(
    (update: (turn: Turn) => Turn) =>
      setTurns((current) => replaceLastTurn(current, update)),
    [],
  )

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await fetchConversations())
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await fetchStatus())
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }, [])

  const openConversation = useCallback(async (id: string) => {
    abortRef.current?.abort()
    setLoadError(null)
    try {
      const conversation = await fetchConversation(id)
      setActiveId(conversation.id)
      setTurns(conversation.turns)
      writeUrlConversation(conversation.id)
    } catch (err) {
      setLoadError(errorMessage(err))
      writeUrlConversation(null)
    }
  }, [])

  const startNewChat = useCallback(() => {
    abortRef.current?.abort()
    setActiveId(null)
    setTurns([])
    setLoadError(null)
    writeUrlConversation(null)
  }, [])

  const removeConversation = useCallback(
    async (id: string) => {
      // Leave it first, so a turn still streaming in it stops before the delete.
      if (id === activeId) startNewChat()
      try {
        await deleteConversation(id)
      } catch (err) {
        setLoadError(errorMessage(err))
      } finally {
        void loadConversations()
      }
    },
    [activeId, startNewChat, loadConversations],
  )

  const handleEvent = useCallback(
    (event: ChatEvent) => {
      if (event.type === "conversation") {
        setActiveId(event.id)
        writeUrlConversation(event.id)
        return
      }
      // Claude synced: refresh the header's counts and last-synced time.
      if (event.type === "tool_result" && event.name === "sync_now")
        void loadStatus()
      updateLastTurn((turn) => applyEvent(turn, event))
    },
    [updateLastTurn, loadStatus],
  )

  const send = useCallback(
    async (message: string) => {
      const question = message.trim()
      if (!question || isStreaming) return

      const controller = new AbortController()
      abortRef.current = controller
      setIsStreaming(true)
      setTurns((current) => [
        ...current,
        { id: crypto.randomUUID(), question, parts: [], status: "streaming" },
      ])

      try {
        await streamChat(
          {
            message: question,
            ...(activeId ? { conversationId: activeId } : {}),
          },
          handleEvent,
          controller.signal,
        )
        updateLastTurn((turn) =>
          markUnfinished(turn, {
            ...turn,
            status: "error",
            error: "The connection closed before the answer finished.",
          }),
        )
      } catch (err) {
        const isStopped = controller.signal.aborted
        updateLastTurn((turn) =>
          isStopped
            ? markUnfinished(turn, { ...turn, status: "stopped" })
            : { ...turn, status: "error", error: errorMessage(err) },
        )
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        setIsStreaming(false)
        void loadConversations()
      }
    },
    [activeId, isStreaming, handleEvent, updateLastTurn, loadConversations],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  useEffect(() => {
    void loadStatus()
    void loadConversations()
    const id = readUrlConversation()
    if (id) void openConversation(id)
  }, [loadStatus, loadConversations, openConversation])

  return {
    conversations,
    activeId,
    turns,
    isStreaming,
    status,
    loadError,
    send,
    stop,
    startNewChat,
    openConversation,
    removeConversation,
    refreshStatus: loadStatus,
  }
}
