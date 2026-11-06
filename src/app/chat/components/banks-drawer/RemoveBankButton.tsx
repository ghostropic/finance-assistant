import { AlertDialog, Button } from "@heroui/react"
import { plural } from "../../utils"
import type { BankSummary } from "../../types"

interface Props {
  bank: BankSummary
  onRemove: (bankId: string) => void
}

/** "Remove", which asks for confirmation before removing the bank. */
export const RemoveBankButton = ({ bank, onRemove }: Props) => (
  <AlertDialog>
    <Button variant="ghost" size="sm" className="text-danger">
      Remove
    </Button>
    <AlertDialog.Backdrop>
      <AlertDialog.Container>
        <RemoveBankDialog bank={bank} onRemove={onRemove} />
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  </AlertDialog>
)

const RemoveBankDialog = ({ bank, onRemove }: Props) => {
  const confirm = () => onRemove(bank.id)

  return (
    <AlertDialog.Dialog>
      <AlertDialog.Header>
        <AlertDialog.Icon status="danger" />
        <AlertDialog.Heading>Remove {bank.institution}?</AlertDialog.Heading>
      </AlertDialog.Header>
      <AlertDialog.Body className="flex flex-col gap-2 text-sm">
        <p>
          This disconnects the bank at Plaid and deletes its{" "}
          {plural(bank.accounts.length, "account")} and{" "}
          {plural(bank.transactionCount, "transaction")} from this app.
        </p>
        <p className="text-muted">
          Saved conversations aren&apos;t deleted, so answers that used this
          bank&apos;s data stay in them.
        </p>
      </AlertDialog.Body>
      <AlertDialog.Footer>
        <Button slot="close" variant="tertiary">
          Cancel
        </Button>
        <Button slot="close" variant="danger" onPress={confirm}>
          Remove
        </Button>
      </AlertDialog.Footer>
    </AlertDialog.Dialog>
  )
}
