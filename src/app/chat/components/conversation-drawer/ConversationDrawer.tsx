import { useState, type ComponentProps } from "react"
import { Button, Drawer } from "@heroui/react"
import { ConversationList } from "../sidebar/ConversationList"

type Props = ComponentProps<typeof ConversationList>

/** The conversation list on narrow screens, where the sidebar is hidden. */
export const ConversationDrawer = ({ onNewChat, onOpen, ...rest }: Props) => {
  const [isOpen, setIsOpen] = useState(false)

  const openDrawer = () => setIsOpen(true)

  const startNewChat = () => {
    setIsOpen(false)
    onNewChat()
  }

  const openConversation = (id: string) => {
    setIsOpen(false)
    onOpen(id)
  }

  return (
    <Drawer>
      <Button
        variant="tertiary"
        size="sm"
        className="md:hidden"
        onPress={openDrawer}
      >
        Chats
      </Button>
      <Drawer.Backdrop isOpen={isOpen} onOpenChange={setIsOpen}>
        <Drawer.Content placement="left">
          <ConversationDrawerDialog
            {...rest}
            onNewChat={startNewChat}
            onOpen={openConversation}
          />
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  )
}

const ConversationDrawerDialog = (props: Props) => (
  <Drawer.Dialog>
    <Drawer.CloseTrigger />
    <Drawer.Header>
      <Drawer.Heading>Conversations</Drawer.Heading>
    </Drawer.Header>
    <Drawer.Body>
      <ConversationList {...props} />
    </Drawer.Body>
  </Drawer.Dialog>
)
