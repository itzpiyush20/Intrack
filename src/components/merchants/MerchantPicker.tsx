// ============================================
// MerchantPicker — pick a saved merchant, or add one, in one box.
//
// The only place the app links a transaction to a merchant (spec
// 2026-09-14-merchant-list-design.md). Free text is always accepted: a failed
// list load or an unsaved name never blocks saving the transaction.
// ============================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Store } from 'lucide-react'
import { Button, Input, Select } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { useCategories } from '@/context/CategoriesContext'
import { addMerchantAlias, createMerchant, listMerchants } from '@/services/merchants'
import { filterMerchants, matchMerchant, merchantKey, type MerchantOption } from '@/utils/merchantKey'
import { cn } from '@/utils'

export interface MerchantPickerValue {
  text: string
  merchantId: string | null
  /** The picked merchant's usual category, for the parent to pre-fill. Only on change. */
  defaultCategory?: string | null
}

interface MerchantPickerProps {
  id: string
  label?: string
  placeholder?: string
  value: MerchantPickerValue
  onChange: (next: Required<MerchantPickerValue>) => void
  className?: string
}

export default function MerchantPicker({ id, label, placeholder = 'e.g. Swiggy', value, onChange, className }: MerchantPickerProps) {
  const { user } = useAuth()
  const { categories } = useCategories()
  const [merchants, setMerchants] = useState<MerchantOption[]>([])
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    listMerchants().then(({ data }) => {
      if (alive) setMerchants(data)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const suggestions = useMemo(() => filterMerchants(value.text, merchants), [value.text, merchants])
  const exact = useMemo(() => matchMerchant(value.text, merchants), [value.text, merchants])
  const canAdd = merchantKey(value.text) !== '' && !exact

  const emit = (text: string, merchant: MerchantOption | null) =>
    onChange({ text, merchantId: merchant?.id ?? null, defaultCategory: merchant?.default_category ?? null })

  const handleType = (text: string) => {
    setOpen(true)
    emit(text, matchMerchant(text, merchants))
  }

  const pick = (merchant: MerchantOption) => {
    if (user) void addMerchantAlias(user.id, merchant, value.text)
    emit(merchant.name, merchant)
    setOpen(false)
  }

  const startAdd = () => {
    setNewName(value.text.replace(/\s+/g, ' ').trim())
    setNewCategory('')
    setAddError('')
    setAdding(true)
    setOpen(false)
  }

  const saveNew = async () => {
    if (!user) return
    setSaving(true)
    const { data, error } = await createMerchant(user.id, newName, newCategory || null)
    setSaving(false)
    if (!data) {
      setAddError(error instanceof Error ? error.message : 'Could not save this merchant. Try again.')
      return
    }
    setMerchants((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]))
    emit(data.name, data)
    setAdding(false)
  }

  const listId = `${id}-options`

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Input
        id={id}
        label={label}
        placeholder={placeholder}
        value={value.text}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={(e) => handleType(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {value.merchantId && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-sb-ink-muted">
          <Store className="h-3 w-3" aria-hidden="true" /> Saved merchant
        </p>
      )}

      {open && (suggestions.length > 0 || canAdd) && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-sb-hairline bg-surface-1 p-1.5 shadow-xl"
        >
          {suggestions.map((m) => (
            <li
              key={m.id}
              role="option"
              aria-selected={m.id === value.merchantId}
              // mouseDown, not click: fires before the input blurs.
              onMouseDown={(e) => {
                e.preventDefault()
                pick(m)
              }}
              className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-lg px-3 text-sm text-sb-ink hover:bg-surface-2"
            >
              <span className="truncate">{m.name}</span>
              {m.default_category && <span className="shrink-0 text-[11px] text-sb-ink-muted">{m.default_category}</span>}
            </li>
          ))}
          {canAdd && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault()
                startAdd()
              }}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-medium text-brand-700 hover:bg-brand-500/10"
            >
              <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">Add &quot;{value.text.trim()}&quot; as a merchant</span>
            </li>
          )}
        </ul>
      )}

      {adding && (
        <div className="mt-2 space-y-3 rounded-xl border border-sb-hairline bg-surface-2/40 p-3">
          <Input
            id={`${id}-new-name`}
            label="Merchant name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={80}
          />
          <Select
            id={`${id}-new-category`}
            label="Usual category (optional)"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            options={[
              { value: '', label: 'No usual category' },
              ...categories.map((c) => ({ value: c.name, label: `${c.emoji} ${c.name}` })),
            ]}
          />
          {addError && (
            <p role="alert" className="text-xs text-[var(--status-danger-text)]">
              {addError}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button" onClick={saveNew} loading={saving} disabled={!merchantKey(newName)}>
              Save merchant
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
