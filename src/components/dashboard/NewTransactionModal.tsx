// ============================================
// NewTransactionModal — pop-up wrapper around the Add Transaction form.
//
// Triggered from the "Add Transaction" CTA in app header, mobile bottom nav,
// or page empty states. Every one of those passes the tapped button's centre
// (`openAddTransaction(button)`), so the popup grows out of the button. The form itself is TransactionForm, the one form every
// add and edit uses.
// ============================================

import Modal from '@/components/ui/Modal'
import TransactionForm from '@/components/transactions/TransactionForm'
import type { ViewportPoint } from '@/components/ui/modalOrigin'
import { useToast } from '@/context'

interface NewTransactionModalProps {
  open: boolean
  onClose: () => void
  /** Called after a transaction is successfully saved so the parent can refresh data. */
  onAdded?: () => void
  /** Viewport centre of the Add button that was tapped; the popup grows from it. */
  origin?: ViewportPoint
}

export default function NewTransactionModal({ open, onClose, onAdded, origin }: NewTransactionModalProps) {
  const { showToast } = useToast()

  // The Modal unmounts its content when closed, so every open starts blank.
  return (
    <Modal isOpen={open} onClose={onClose} title="Add Transaction" sheet origin={origin}>
      <TransactionForm
        onSaved={() => {
          window.dispatchEvent(new CustomEvent('intrack:transaction-added'))
          showToast('Transaction added')
          onAdded?.()
          onClose()
        }}
      />
    </Modal>
  )
}
