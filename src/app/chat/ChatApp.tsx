"use client"

import { useEffect, useRef } from "react"
import { Button } from "@heroui/react"
import { BanksDrawer } from "./components/banks-drawer/BanksDrawer"
import { ChatHeader } from "./components/chat-header/ChatHeader"
import { Composer } from "./components/composer/Composer"
import { ConversationDrawer } from "./components/conversation-drawer/ConversationDrawer"
import { EmptyState } from "./components/empty-state/EmptyState"
import { HeaderActions } from "./components/header-actions/HeaderActions"
import { NoticeBanner } from "./components/notice-banner/NoticeBanner"
import { Sidebar } from "./components/sidebar/Sidebar"
import { TurnList } from "./components/turn-view/TurnList"
import { SCROLL_FOLLOW_THRESHOLD_PX } from "./constants"
import { useBanks } from "./hooks/use-banks"
import { useChat } from "./hooks/use-chat"

const isNearBottom = (element: HTMLElement) =>
  element.scrollHeight - element.scrollTop - element.clientHeight <
  SCROLL_FOLLOW_THRESHOLD_PX

export const ChatApp = () => {
  const {
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
    refreshStatus,
  } = useChat()
  const banks = useBanks({ onDataChanged: refreshStatus })
  const scrollRef = useRef<HTMLDivElement>(null)

  const conversationListProps = {
    conversations,
    activeId,
    onNewChat: startNewChat,
    onOpen: openConversation,
    onDelete: removeConversation,
  }
  const hasTurns = turns.length > 0
  const hasLoadError = loadError !== null
  const environmentError = status?.environmentError ?? null
  const hasEnvironmentError = environmentError !== null
  const showNoticeInPage = banks.notice !== null && !banks.isOpen
  const needsBank = status !== null && status.banks === 0
  const canSync = (status?.banks ?? 0) > 0 && !hasEnvironmentError

  const connectLabel = banks.isConnecting ? "Connecting…" : "Connect a bank"

  const connectBank = () => void banks.startLink()

  const connectAction = needsBank ? (
    <Button
      isPending={banks.isLinkingNewBank || banks.isConnecting}
      isDisabled={hasEnvironmentError}
      onPress={connectBank}
    >
      {connectLabel}
    </Button>
  ) : undefined

  const banksDrawer = (
    <BanksDrawer
      isOpen={banks.isOpen}
      onOpenChange={banks.handleOpenChange}
      banks={banks.banks}
      notice={banks.notice}
      environmentError={environmentError}
      isConnecting={banks.isConnecting}
      isSyncing={banks.isSyncing}
      isLinkingNewBank={banks.isLinkingNewBank}
      linkingBankId={banks.linkingBankId}
      onStartLink={banks.startLink}
      onSync={banks.sync}
      onRemove={banks.remove}
      onDismissNotice={banks.dismissNotice}
    />
  )

  const headerActions = (
    <HeaderActions
      isSyncing={banks.isSyncing}
      canSync={canSync}
      banksNeedingReconnect={status?.banksNeedingReconnect ?? 0}
      onSync={banks.sync}
      onOpenBanks={banks.openBanks}
      banksDrawer={banksDrawer}
    />
  )

  useEffect(() => {
    const element = scrollRef.current
    if (element && (isStreaming || isNearBottom(element)))
      element.scrollTo({ top: element.scrollHeight })
  }, [turns, isStreaming])

  return (
    <div className="grid h-dvh grid-cols-1 md:grid-cols-[260px_1fr]">
      <Sidebar {...conversationListProps} />
      <main className="flex min-h-0 min-w-0 flex-col">
        <ChatHeader
          status={status}
          menu={<ConversationDrawer {...conversationListProps} />}
          actions={headerActions}
        />
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-7 px-6 pt-6 pb-10">
            {hasEnvironmentError && (
              <NoticeBanner
                notice={{ tone: "danger", text: environmentError }}
              />
            )}
            {showNoticeInPage && (
              <NoticeBanner
                notice={banks.notice!}
                onDismiss={banks.dismissNotice}
              />
            )}
            {hasLoadError && (
              <p className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
                {loadError}
              </p>
            )}
            {hasTurns ? (
              <TurnList turns={turns} />
            ) : (
              <EmptyState onAsk={send} connectAction={connectAction} />
            )}
          </div>
        </div>
        <Composer isStreaming={isStreaming} onSend={send} onStop={stop} />
      </main>
    </div>
  )
}
