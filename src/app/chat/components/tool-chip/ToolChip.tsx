import { Disclosure, Spinner, cn } from "@heroui/react"
import { formatToolName } from "@/tools/summary"
import type { Part } from "@/chat/display"

type ToolPart = Extract<Part, { type: "tool" }>

interface Props {
  tool: ToolPart
}

const StatusIcon = ({ status }: { status: ToolPart["status"] }) => {
  if (status === "running") {
    return <Spinner size="sm" color="accent" aria-label="Running" />
  }
  const isOk = status === "ok"
  const className = isOk ? "text-accent" : "text-danger"
  const symbol = isOk ? "✓" : "✗"

  return <span className={className}>{symbol}</span>
}

export const ToolChip = ({ tool }: Props) => {
  const hasError = tool.status === "error"
  const hasSummary = Boolean(tool.summary)
  const input = JSON.stringify(tool.input, null, 2)
  const className = cn(
    "max-w-full self-start rounded-lg border bg-surface text-sm",
    hasError ? "border-danger" : "border-border",
  )

  return (
    <Disclosure className={className}>
      <Disclosure.Heading>
        <Disclosure.Trigger className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-2.5 py-1.5 text-left">
          <StatusIcon status={tool.status} />
          <span className="font-medium whitespace-nowrap">
            {formatToolName(tool.name)}
          </span>
          {hasSummary && <span className="text-muted">· {tool.summary}</span>}
        </Disclosure.Trigger>
      </Disclosure.Heading>
      <Disclosure.Content>
        <pre className="overflow-x-auto border-t border-border bg-default px-2.5 py-2 font-mono text-xs">
          {input}
        </pre>
      </Disclosure.Content>
    </Disclosure>
  )
}
