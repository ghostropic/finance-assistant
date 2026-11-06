import { MarkdownText } from "../markdown-text/MarkdownText"
import { ToolChip } from "../tool-chip/ToolChip"
import type { Part } from "@/chat/display"

interface Props {
  part: Part
}

export const PartView = ({ part }: Props) => {
  switch (part.type) {
    case "notice":
      return <p className="text-sm text-muted italic">{part.text}</p>
    case "tool":
      return <ToolChip tool={part} />
    case "text":
      return <MarkdownText text={part.text} />
  }
}
