import { CloseButton, Spinner, cn } from "@heroui/react"
import type { Notice } from "../../utils"

interface Props {
  notice: Notice
  onDismiss?: () => void
}

const TONE_CLASSES: Record<Notice["tone"], string> = {
  progress: "bg-accent-soft text-accent-soft-foreground",
  success: "bg-success-soft text-success-soft-foreground",
  warning: "bg-warning-soft text-warning-soft-foreground",
  danger: "bg-danger-soft text-danger-soft-foreground",
}

export const NoticeBanner = ({ notice, onDismiss }: Props) => {
  const isInProgress = notice.tone === "progress"
  const isDismissable = onDismiss !== undefined && !isInProgress
  const className = cn(
    "flex items-start justify-between gap-3 rounded-lg px-3.5 py-2.5 text-sm",
    TONE_CLASSES[notice.tone],
  )

  return (
    <div
      role={notice.tone === "danger" ? "alert" : "status"}
      className={className}
    >
      <div className="flex items-center gap-2.5">
        {isInProgress && <Spinner size="sm" />}
        <p>{notice.text}</p>
      </div>
      {isDismissable && (
        <CloseButton aria-label="Dismiss" onPress={onDismiss} />
      )}
    </div>
  )
}
