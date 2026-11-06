import { cn } from "@heroui/react"
import { DeleteConversationButton } from "./DeleteConversationButton"
import type { ConversationSummary } from "../../types"

interface Props {
  conversation: ConversationSummary
  isActive: boolean
  onOpen: (id: string) => void
  onDelete: (id: string) => void
}

export const ConversationItem = ({
  conversation,
  isActive,
  onOpen,
  onDelete,
}: Props) => {
  const className = cn(
    "group flex items-center rounded-lg text-foreground hover:bg-default-hover",
    isActive &&
      "bg-accent-soft text-accent-soft-foreground hover:bg-accent-soft-hover",
  )
  const ariaCurrent = isActive ? "page" : undefined

  const open = () => onOpen(conversation.id)

  return (
    <div className={className}>
      <button
        className="min-w-0 flex-1 truncate px-2.5 py-2 text-left text-sm"
        onClick={open}
        title={conversation.title}
        aria-current={ariaCurrent}
      >
        {conversation.title}
      </button>
      <DeleteConversationButton
        conversation={conversation}
        onDelete={onDelete}
      />
    </div>
  )
}
