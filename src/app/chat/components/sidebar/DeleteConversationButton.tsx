import { AlertDialog, Button } from "@heroui/react"
import type { ConversationSummary } from "../../types"

interface Props {
  conversation: ConversationSummary
  onDelete: (id: string) => void
}

/** A trash button, which asks for confirmation before deleting the conversation. */
export const DeleteConversationButton = ({ conversation, onDelete }: Props) => (
  <AlertDialog>
    <Button
      isIconOnly
      variant="ghost"
      size="sm"
      className="mr-1 shrink-0 text-muted hover:text-danger md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
      aria-label={`Delete ${conversation.title}`}
    >
      <TrashIcon />
    </Button>
    <AlertDialog.Backdrop>
      <AlertDialog.Container>
        <DeleteConversationDialog
          conversation={conversation}
          onDelete={onDelete}
        />
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  </AlertDialog>
)

const DeleteConversationDialog = ({ conversation, onDelete }: Props) => {
  const confirm = () => onDelete(conversation.id)

  return (
    <AlertDialog.Dialog>
      <AlertDialog.Header>
        <AlertDialog.Icon status="danger" />
        <AlertDialog.Heading>Delete this conversation?</AlertDialog.Heading>
      </AlertDialog.Header>
      <AlertDialog.Body className="flex flex-col gap-2 text-sm">
        <p className="font-medium wrap-break-word">{conversation.title}</p>
        <p className="text-muted">
          Its questions and answers are deleted from this app. This can&apos;t
          be undone.
        </p>
      </AlertDialog.Body>
      <AlertDialog.Footer>
        <Button slot="close" variant="tertiary">
          Cancel
        </Button>
        <Button slot="close" variant="danger" onPress={confirm}>
          Delete
        </Button>
      </AlertDialog.Footer>
    </AlertDialog.Dialog>
  )
}

const TrashIcon = () => (
  <svg
    viewBox="0 0 16 16"
    className="size-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.75 6.5v4.5M9.25 6.5v4.5" />
  </svg>
)
