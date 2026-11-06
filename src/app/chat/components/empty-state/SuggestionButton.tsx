import { Button } from "@heroui/react"

interface Props {
  question: string
  onAsk: (question: string) => void
}

export const SuggestionButton = ({ question, onAsk }: Props) => {
  const ask = () => onAsk(question)

  return (
    <Button
      variant="outline"
      className="h-auto justify-start py-3 text-left whitespace-normal"
      onPress={ask}
    >
      {question}
    </Button>
  )
}
