import { SUGGESTED_QUESTIONS } from "../../constants"
import { SuggestionButton } from "./SuggestionButton"
import type { ReactNode } from "react"

interface Props {
  onAsk: (question: string) => void
  /** Shown instead of the example questions when no bank is connected yet. */
  connectAction?: ReactNode
}

export const EmptyState = ({ onAsk, connectAction }: Props) => {
  const needsBank = connectAction !== undefined
  const subtitle = needsBank
    ? "Connect a bank first. Answers come from its synced transactions and balances."
    : "Answers come from your synced transactions and balances."

  return (
    <div className="mt-[12vh] flex flex-col items-center gap-2 text-center">
      <h2 className="text-2xl font-semibold">Ask about your money</h2>
      <p className="text-sm text-muted">{subtitle}</p>
      {needsBank ? (
        <div className="mt-4">{connectAction}</div>
      ) : (
        <SuggestedQuestions onAsk={onAsk} />
      )}
    </div>
  )
}

const SuggestedQuestions = ({ onAsk }: Pick<Props, "onAsk">) => (
  <div className="mt-4 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
    {SUGGESTED_QUESTIONS.map((question) => (
      <SuggestionButton key={question} question={question} onAsk={onAsk} />
    ))}
  </div>
)
