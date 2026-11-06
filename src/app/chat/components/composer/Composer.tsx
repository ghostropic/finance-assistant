import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react"
import { Button, TextArea } from "@heroui/react"
import { MAX_QUESTION_LENGTH } from "../../constants"

interface Props {
  isStreaming: boolean
  onSend: (question: string) => void
  onStop: () => void
}

const isSendKey = (event: KeyboardEvent<HTMLTextAreaElement>) =>
  event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing

export const Composer = ({ isStreaming, onSend, onStop }: Props) => {
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const [text, setText] = useState("")

  const canSend = text.trim().length > 0 && !isStreaming

  const sendQuestion = () => {
    if (!canSend) return
    onSend(text)
    setText("")
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    sendQuestion()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isSendKey(event)) return
    event.preventDefault()
    sendQuestion()
  }

  const updateText = (event: ChangeEvent<HTMLTextAreaElement>) =>
    setText(event.target.value)

  // Measuring an empty box would size it to its placeholder, so it only grows once there's text.
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = ""
    if (text)
      input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`
  }, [text])

  return (
    <form
      className="mx-auto flex w-full max-w-3xl items-end gap-2.5 px-6 pt-3 pb-5"
      onSubmit={handleSubmit}
    >
      <TextArea
        ref={inputRef}
        className="max-h-50 min-w-0 flex-1 resize-none"
        value={text}
        onChange={updateText}
        onKeyDown={handleKeyDown}
        placeholder="Ask about your money"
        aria-label="Your question"
        rows={1}
        maxLength={MAX_QUESTION_LENGTH}
        autoFocus
      />
      {isStreaming ? (
        <StopButton onStop={onStop} />
      ) : (
        <SendButton isDisabled={!canSend} />
      )}
    </form>
  )
}

const SendButton = ({ isDisabled }: { isDisabled: boolean }) => (
  <Button type="submit" isDisabled={isDisabled}>
    Send
  </Button>
)

const StopButton = ({ onStop }: { onStop: () => void }) => (
  <Button variant="danger-soft" onPress={onStop}>
    Stop
  </Button>
)
