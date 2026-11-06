import { Alert } from "@heroui/react"
import { formatUsage } from "@/chat/format"
import { PartView } from "./PartView"
import type { Part, Turn } from "@/chat/display"

interface Props {
  turn: Turn
}

const partKey = (part: Part, index: number) =>
  part.type === "tool" ? part.id : `${part.type}-${index}`

export const TurnView = ({ turn }: Props) => {
  const isWaiting = turn.status === "streaming" && turn.parts.length === 0
  const isStopped = turn.status === "stopped"
  const hasError = turn.status === "error"
  const errorText = `${turn.error ?? "Something went wrong."} This question wasn't saved.`
  const usageText = turn.usage ? formatUsage(turn.usage) : null
  const hasUsage = usageText !== null

  return (
    <section className="flex flex-col gap-3">
      <div className="max-w-[80%] self-end rounded-2xl bg-accent-soft px-3.5 py-2.5 whitespace-pre-wrap">
        {turn.question}
      </div>
      <div className="flex flex-col gap-2.5">
        {isWaiting && <p className="animate-pulse text-muted">Thinking…</p>}
        {turn.parts.map((part, index) => (
          <PartView key={partKey(part, index)} part={part} />
        ))}
        {isStopped && (
          <p className="text-sm text-muted italic">
            Stopped. This question wasn&apos;t saved.
          </p>
        )}
        {hasError && <ErrorAlert text={errorText} />}
        {hasUsage && <p className="text-xs text-muted">{usageText}</p>}
      </div>
    </section>
  )
}

const ErrorAlert = ({ text }: { text: string }) => (
  <Alert status="danger">
    <Alert.Indicator />
    <Alert.Content>
      <Alert.Description>{text}</Alert.Description>
    </Alert.Content>
  </Alert>
)
