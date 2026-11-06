import { Button, Drawer } from "@heroui/react"
import { NoticeBanner } from "../notice-banner/NoticeBanner"
import { BankCard } from "./BankCard"
import type { BankSummary } from "../../types"
import type { Notice } from "../../utils"

interface Props {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  banks: BankSummary[]
  notice: Notice | null
  /** Set when PLAID_ENV doesn't match the database; connecting and syncing are refused. */
  environmentError: string | null
  isConnecting: boolean
  isSyncing: boolean
  /** Plaid Link is open, or opening, for a new bank. */
  isLinkingNewBank: boolean
  /** The bank Plaid Link is open, or opening, to reconnect. */
  linkingBankId: string | null
  /** Opens Plaid Link: for a new bank, or with a bank ID to reconnect it. */
  onStartLink: (bankId?: string) => void
  onSync: () => void
  onRemove: (bankId: string) => void
  onDismissNotice: () => void
}

/**
 * The "Banks" button and the panel it opens: connected banks, with Connect, Sync,
 * Reconnect and Remove (docs/milestone-3.md). Open state is controlled so other
 * parts of the page can open it, and so it can close when Plaid Link opens.
 */
export const BanksDrawer = ({ isOpen, onOpenChange, ...rest }: Props) => (
  <Drawer isOpen={isOpen} onOpenChange={onOpenChange}>
    <Button variant="tertiary" size="sm">
      Banks
    </Button>
    <Drawer.Backdrop>
      <Drawer.Content placement="right">
        <BanksDrawerDialog {...rest} />
      </Drawer.Content>
    </Drawer.Backdrop>
  </Drawer>
)

type DialogProps = Omit<Props, "isOpen" | "onOpenChange">

const BanksDrawerDialog = ({
  banks,
  notice,
  environmentError,
  isConnecting,
  isSyncing,
  isLinkingNewBank,
  linkingBankId,
  onStartLink,
  onSync,
  onRemove,
  onDismissNotice,
}: DialogProps) => {
  const hasBanks = banks.length > 0
  const hasNotice = notice !== null
  const hasEnvironmentError = environmentError !== null
  const connectLabel = isConnecting ? "Connecting…" : "Connect a bank"
  const syncLabel = isSyncing ? "Syncing…" : "Sync all"

  const connectBank = () => onStartLink()

  return (
    <Drawer.Dialog>
      <Drawer.CloseTrigger />
      <Drawer.Header>
        <Drawer.Heading>Banks</Drawer.Heading>
      </Drawer.Header>
      <Drawer.Body className="flex flex-col gap-3">
        {hasEnvironmentError && (
          <NoticeBanner notice={{ tone: "danger", text: environmentError }} />
        )}
        {hasNotice && (
          <NoticeBanner notice={notice} onDismiss={onDismissNotice} />
        )}
        {hasBanks ? (
          <BankList
            banks={banks}
            linkingBankId={linkingBankId}
            onReconnect={onStartLink}
            onRemove={onRemove}
          />
        ) : (
          <p className="text-sm text-muted">No banks connected yet.</p>
        )}
      </Drawer.Body>
      <Drawer.Footer className="flex items-start gap-2">
        <Button
          isPending={isLinkingNewBank || isConnecting}
          isDisabled={hasEnvironmentError}
          onPress={connectBank}
        >
          {connectLabel}
        </Button>
        <Button
          variant="tertiary"
          isPending={isSyncing}
          isDisabled={!hasBanks || hasEnvironmentError}
          onPress={onSync}
        >
          {syncLabel}
        </Button>
      </Drawer.Footer>
    </Drawer.Dialog>
  )
}

interface BankListProps {
  banks: BankSummary[]
  linkingBankId: string | null
  onReconnect: (bankId: string) => void
  onRemove: (bankId: string) => void
}

const BankList = ({
  banks,
  linkingBankId,
  onReconnect,
  onRemove,
}: BankListProps) => (
  <div className="flex flex-col gap-3">
    {banks.map((bank) => (
      <BankCard
        key={bank.id}
        bank={bank}
        isReconnecting={linkingBankId === bank.id}
        onReconnect={onReconnect}
        onRemove={onRemove}
      />
    ))}
  </div>
)
