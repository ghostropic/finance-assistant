import { ConversationList } from "./ConversationList"
import type { ComponentProps } from "react"

type Props = ComponentProps<typeof ConversationList>

export const Sidebar = (props: Props) => (
  <aside
    className="hidden min-h-0 flex-col border-r border-border bg-background-secondary px-3 py-4 md:flex"
    aria-label="Conversations"
  >
    <ConversationList {...props} />
  </aside>
)
