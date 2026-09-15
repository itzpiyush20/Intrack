// ============================================
// MerchantPicker — pick a saved merchant, or add one, in one box.
//
// The only place the app links a transaction to a merchant (spec
// 2026-09-14-merchant-list-design.md). Free text is always accepted: a failed
// list load or an unsaved name never blocks saving the transaction.
//
// It lives inside host <form>s, so Enter is only swallowed when it acts on the
// picker itself (an active option, or the add panel's name field). Pages that
// render many pickers pass one shared `merchants` list instead of each loading.
// ============================================

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Plus, Store } from 'lucide-react'
import { Button, Input, Select } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { useCategories } from '@/context/CategoriesContext'
import { createMerchant, listMerchants } from '@/services/merchants'
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
  /** Keep `label` as the accessible name but render no visible label. */
  hideLabel?: boolean
  placeholder?: string
  value: MerchantPickerValue
  onChange: (next: Required<MerchantPickerValue>) => void
  /** Shared list from the parent. When given, the picker does not load its own. */
  merchants?: MerchantOption[]
  /** Called after a merchant is created, so the parent can add it to its shared list. */
  onMerchantAdded?: (merchant: MerchantOption) => void
  className?: string
}

const GENERIC_SAVE_ERROR = 'Could not save this merchant. Try again.'

export default function MerchantPicker({
  id,
  label,
  hideLabel = false,
  placeholder = 'e.g. Swiggy',
  value,
  onChange,
  merchants: sharedMerchants,
  onMerchantAdded,
  className,
}: MerchantPickerProps) {
  const { user } = useAuth()
  const { categories } = useCategories()
  const [loaded, setLoaded] = useState<MerchantOption[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const usesShared = sharedMerchants !== undefined
  const merchants = sharedMerchants ?? loaded

  useEffect(() => {
    if (usesShared) return
    let alive = true
    listMerchants()
      .then(({ data, error }) => {
        if (!alive) return
        setLoaded(data)
        if (error) setLoadFailed(true)
      })
      .catch(() => {
        if (alive) setLoadFailed(true)
      })
    return () => {
      alive = false
    }
  }, [usesShared])

  // Closing always clears the highlight, so a reopened list never has a stale active row.
  const close = () => {
    setOpen(false)
    setActiveIndex(-1)
  }

  useEffect(() => {
    const onOutside = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setActiveIndex(-1)
      }
    }
    document.addEventListener('pointerdown', onOutside)
    return () => document.removeEventListener('pointerdown', onOutside)
  }, [])

  const emit = (text: string, merchant: MerchantOption | null) =>
    onChange({ text, merchantId: merchant?.id ?? null, defaultCategory: merchant?.default_category ?? null })

  // A link is only ever the user's act. Text that arrived as the initial value
  // (an edited row, a prefilled name) is never linked just because it matches.
  const typedRef = useRef(false)

  // Once per list (load or prop change): link text the user typed before the list arrived.
  const linkedForList = useRef<MerchantOption[] | null>(null)
  useEffect(() => {
    if (linkedForList.current === merchants) return
    linkedForList.current = merchants
    if (!typedRef.current || value.merchantId) return
    const match = matchMerchant(value.text, merchants)
    if (match) onChange({ text: value.text, merchantId: match.id, defaultCategory: match.default_category })
  }, [merchants, value.text, value.merchantId, onChange])

  const suggestions = useMemo(() => filterMerchants(value.text, merchants), [value.text, merchants])
  const exact = useMemo(() => matchMerchant(value.text, merchants), [value.text, merchants])
  const canAdd = merchantKey(value.text) !== '' && !exact
  const itemCount = suggestions.length + (canAdd ? 1 : 0)
  const listShown = open && itemCount > 0

  // Clear the highlight whenever the items change (adjust-during-render, not an effect).
  // A row is active only after ArrowDown/ArrowUp or hover, so Enter never picks
  // or adds something the user did not point at.
  const itemsKey = `${suggestions.map((m) => m.id).join('|')}#${canAdd}`
  const [prevItemsKey, setPrevItemsKey] = useState<string | null>(null)
  if (prevItemsKey !== itemsKey) {
    setPrevItemsKey(itemsKey)
    setActiveIndex(-1)
  }

  const handleType = (text: string) => {
    typedRef.current = true
    setOpen(true)
    emit(text, matchMerchant(text, merchants))
  }

  const pick = (merchant: MerchantOption) => {
    // Spelling learning happens on Pending approval now, not here — every
    // suggestion already contains the typed text (that's how it was
    // suggested), so picking never has a genuinely new spelling to save.
    emit(merchant.name, merchant)
    close()
  }

  const startAdd = () => {
    setNewName(value.text.replace(/\s+/g, ' ').trim().slice(0, 80).trimEnd())
    setNewCategory('')
    setAddError('')
    setAdding(true)
    close()
  }

  const saveNew = async () => {
    if (!user || saving) return
    setSaving(true)
    try {
      const { data, error } = await createMerchant(user.id, newName, newCategory || null)
      if (!data) {
        // Only the client-side empty-name check is safe to show verbatim; any
        // other error (a PostgrestError extends Error too) could leak raw
        // database detail, so it gets the generic message.
        const clientSideEmptyName = error instanceof Error && merchantKey(newName) === ''
        setAddError(clientSideEmptyName ? error.message : GENERIC_SAVE_ERROR)
        return
      }
      setLoaded((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]))
      onMerchantAdded?.(data)
      emit(data.name, data)
      setAdding(false)
    } catch {
      setAddError(GENERIC_SAVE_ERROR)
    } finally {
      setSaving(false)
    }
  }

  const listId = `${id}-options`
  const optionId = (i: number) => `${listId}-${i}`
  const activeOk = listShown && activeIndex >= 0 && activeIndex < itemCount

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      if (!open) {
        setOpen(true)
        // Opening by arrow is itself a move onto the first (or last) row.
        if (itemCount > 0) setActiveIndex(step > 0 ? 0 : itemCount - 1)
        return
      }
      if (itemCount === 0) return
      setActiveIndex((prev) =>
        prev < 0 ? (step > 0 ? 0 : itemCount - 1) : (prev + step + itemCount) % itemCount
      )
    } else if (e.key === 'Enter') {
      // List closed or nothing active: let the host form submit the free text.
      if (!activeOk) return
      e.preventDefault()
      if (activeIndex < suggestions.length) pick(suggestions[activeIndex])
      else startAdd()
    } else if (e.key === 'Escape') {
      close()
    }
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Input
        id={id}
        label={hideLabel ? undefined : label}
        aria-label={hideLabel ? label : undefined}
        placeholder={placeholder}
        value={value.text}
        autoComplete="off"
        role="combobox"
        aria-expanded={listShown}
        aria-controls={listShown ? listId : undefined}
        aria-activedescendant={activeOk ? optionId(activeIndex) : undefined}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        // Options use mouseDown + preventDefault, so picking never blurs the box.
        onBlur={close}
        onChange={(e) => handleType(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {value.merchantId && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-sb-ink-muted">
          <Store className="h-3 w-3" aria-hidden="true" /> Saved merchant
        </p>
      )}
      {loadFailed && (
        <p className="mt-1 text-[11px] text-sb-ink-muted">Saved merchants couldn&apos;t load — you can still type a name.</p>
      )}

      {listShown && (
        <ul
          id={listId}
          role="listbox"
          // Keep focus in the box when the press lands on padding or the scrollbar.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-sb-hairline bg-surface-1 p-1.5 shadow-xl"
        >
          {suggestions.map((m, i) => (
            <li
              key={m.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              onMouseEnter={() => setActiveIndex(i)}
              // mouseDown, not click: fires before the input blurs.
              onMouseDown={(e) => {
                e.preventDefault()
                pick(m)
              }}
              className={cn(
                'flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-lg px-3 text-sm text-sb-ink',
                i === activeIndex && 'bg-surface-2'
              )}
            >
              <span className="truncate">{m.name}</span>
              {m.default_category && <span className="shrink-0 text-[11px] text-sb-ink-muted">{m.default_category}</span>}
            </li>
          ))}
          {canAdd && (
            <li
              id={optionId(suggestions.length)}
              role="option"
              aria-selected={activeIndex === suggestions.length}
              onMouseEnter={() => setActiveIndex(suggestions.length)}
              onMouseDown={(e) => {
                e.preventDefault()
                startAdd()
              }}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-medium text-brand-700',
                activeIndex === suggestions.length && 'bg-brand-500/10'
              )}
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
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              // Never submit the host form from here.
              e.preventDefault()
              if (merchantKey(newName)) void saveNew()
            }}
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
