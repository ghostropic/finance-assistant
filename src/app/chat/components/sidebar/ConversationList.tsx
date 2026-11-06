import { Button } from "@heroui/react"
import { ConversationItem } from "./ConversationItem"
import type { ConversationSummary } from "../../types"

interface Props {
  conversations: ConversationSummary[]
  activeId: string | null
  onNewChat: () => void
  onOpen: (id: string) => void
  onDelete: (id: string) => void
}

export const ConversationList = ({
  conversations,
  activeId,
  onNewChat,
  onOpen,
  onDelete,
}: Props) => {
  const hasConversations = conversations.length > 0

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <Button variant="outline" fullWidth onPress={onNewChat}>
        New chat
      </Button>
      <nav className="flex flex-col gap-0.5 overflow-y-auto">
        {!hasConversations && (
          <p className="text-sm text-muted">No conversations yet.</p>
        )}
        {conversations.map((conversation) => (
          <ConversationItem
            key={conversation.id}
            conversation={conversation}
            isActive={conversation.id === activeId}
            onOpen={onOpen}
            onDelete={onDelete}
          />
        ))}
      </nav>
    </div>
  )
}
