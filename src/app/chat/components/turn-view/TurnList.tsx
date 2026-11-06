import { TurnView } from "./TurnView"
import type { Turn } from "@/chat/display"

interface Props {
  turns: Turn[]
}

export const TurnList = ({ turns }: Props) => (
  <>
    {turns.map((turn) => (
      <TurnView key={turn.id} turn={turn} />
    ))}
  </>
)
