import { Button, Chip } from "@heroui/react"
import { formatSyncedAt, plural } from "../../utils"
import { RemoveBankButton } from "./RemoveBankButton"
import type { BankSummary } from "../../types"

interface Props {
  bank: BankSummary
  /** Plaid Link is open, or opening, to reconnect this bank. */
  isReconnecting: boolean
  onReconnect: (bankId: string) => void
  onRemove: (bankId: string) => void
}

type Account = BankSummary["accounts"][number]

const formatAccountDetail = (account: Account) =>
  [account.mask && `••${account.mask}`, account.subtype ?? account.type]
    .filter(Boolean)
    .join(" · ")

export const BankCard = ({
  bank,
  isReconnecting,
  onReconnect,
  onRemove,
}: Props) => {
  const needsReconnect = bank.status === "needs_reconnect"
  const hasFailedSync = !needsReconnect && bank.lastErrorCode !== null
  const summary = `${plural(bank.transactionCount, "transaction")} · ${formatSyncedAt(bank.lastSyncedAt)}`

  const reconnect = () => onReconnect(bank.id)

  return (
    <section className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{bank.institution}</h3>
          <p className="text-xs text-muted">{summary}</p>
        </div>
        {needsReconnect && (
          <Chip color="warning" size="sm">
            Needs reconnecting
          </Chip>
        )}
        {hasFailedSync && (
          <Chip color="danger" size="sm">
            Last sync failed
          </Chip>
        )}
      </div>
      <ul className="mt-3 flex flex-col gap-1 text-sm">
        {bank.accounts.map((account, index) => (
          <AccountRow
            key={`${account.name}-${account.mask}-${index}`}
            account={account}
          />
        ))}
      </ul>
      <div className="mt-4 flex items-start gap-2">
        {needsReconnect && (
          <Button size="sm" isPending={isReconnecting} onPress={reconnect}>
            Reconnect
          </Button>
        )}
        <RemoveBankButton bank={bank} onRemove={onRemove} />
      </div>
    </section>
  )
}

const AccountRow = ({ account }: { account: Account }) => (
  <li className="flex justify-between gap-3">
    <span>{account.name}</span>
    <span className="text-muted">{formatAccountDetail(account)}</span>
  </li>
)
