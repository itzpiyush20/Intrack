// ============================================
// TagPicker — Autocomplete & Creator for Transaction Tags
// ============================================

import { useState, useEffect, useRef, useMemo, type KeyboardEvent } from 'react'
import { cn } from '@/utils'
import { getDistinctTags } from '@/services'
import { Tag as TagIcon, X, Plus, Check } from 'lucide-react'

export interface TagPickerProps {
  tags: string[]
  onChange: (tags: string[]) => void
  label?: string
  placeholder?: string
  disabled?: boolean
  maxTags?: number
  availableTags?: string[]
  className?: string
  id?: string
}

/** Suggested defaults when the user has no past tags in their history yet */
const STARTER_TAG_SUGGESTIONS = [
  'Goa Trip 2026',
  'Kitchen Renovation',
  'Wedding',
  'Work Reimbursement',
  'Vacation',
  'Medical',
  'Diwali',
  'Birthday',
]

export default function TagPicker({
  tags,
  onChange,
  label = 'Tags & Events',
  placeholder = 'Add tag (e.g. Goa Trip 2026, Wedding)...',
  disabled = false,
  maxTags = 10,
  availableTags: propAvailableTags,
  className,
  id,
}: TagPickerProps) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number>(-1)
  const [fetchedTags, setFetchedTags] = useState<string[]>([])
  const [loadingTags, setLoadingTags] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const inputId = id || 'tag-picker-input'

  // Fetch past distinct tags from user's history
  useEffect(() => {
    if (propAvailableTags) return

    let isMounted = true
    setLoadingTags(true)
    getDistinctTags()
      .then((historyTags) => {
        if (isMounted) {
          setFetchedTags(historyTags)
          setLoadingTags(false)
        }
      })
      .catch(() => {
        if (isMounted) setLoadingTags(false)
      })

    return () => {
      isMounted = false
    }
  }, [propAvailableTags])

  // Combine user's distinct history with starter tags (prioritizing history)
  const allKnownTags = useMemo(() => {
    const base = propAvailableTags ?? fetchedTags
    const combined = new Set<string>(base)
    if (base.length === 0) {
      STARTER_TAG_SUGGESTIONS.forEach((t) => combined.add(t))
    }
    return Array.from(combined)
  }, [propAvailableTags, fetchedTags])

  // Cleaned query
  const trimmedQuery = query.trim()

  // Suggestions matching the query and not already selected
  const matchingSuggestions = useMemo(() => {
    const q = trimmedQuery.toLowerCase()
    return allKnownTags.filter((tag) => {
      const isSelected = tags.some((t) => t.toLowerCase() === tag.toLowerCase())
      if (isSelected) return false
      if (!q) return true
      return tag.toLowerCase().includes(q)
    })
  }, [allKnownTags, tags, trimmedQuery])

  // Whether the typed query is an entirely new tag not present in suggestions or selected
  const isNewTag = useMemo(() => {
    if (!trimmedQuery) return false
    const matchesExisting = allKnownTags.some(
      (t) => t.toLowerCase() === trimmedQuery.toLowerCase()
    )
    const matchesSelected = tags.some(
      (t) => t.toLowerCase() === trimmedQuery.toLowerCase()
    )
    return !matchesExisting && !matchesSelected
  }, [trimmedQuery, allKnownTags, tags])

  // Dropdown option list: matching suggestions, plus custom create option if new
  const dropdownItems = useMemo(() => {
    const items: Array<{ type: 'existing' | 'create'; tag: string }> = []
    if (isNewTag) {
      items.push({ type: 'create', tag: trimmedQuery })
    }
    matchingSuggestions.slice(0, 8).forEach((tag) => {
      items.push({ type: 'existing', tag })
    })
    return items
  }, [isNewTag, trimmedQuery, matchingSuggestions])

  // Reset active index when dropdown items change
  useEffect(() => {
    setActiveIndex(dropdownItems.length > 0 ? 0 : -1)
  }, [dropdownItems.length])

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const addTag = (rawTag: string) => {
    const tagToAdd = rawTag.trim()
    if (!tagToAdd) return
    if (tags.length >= maxTags) return

    // Case-insensitive dedup
    const alreadyExists = tags.some(
      (t) => t.toLowerCase() === tagToAdd.toLowerCase()
    )
    if (!alreadyExists) {
      onChange([...tags, tagToAdd])
    }

    setQuery('')
    setIsOpen(false)
    inputRef.current?.focus()
  }

  const removeTag = (tagToRemove: string) => {
    if (disabled) return
    onChange(tags.filter((t) => t !== tagToRemove))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!isOpen) {
        setIsOpen(true)
        return
      }
      setActiveIndex((prev) =>
        prev < dropdownItems.length - 1 ? prev + 1 : 0
      )
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!isOpen) {
        setIsOpen(true)
        return
      }
      setActiveIndex((prev) =>
        prev > 0 ? prev - 1 : dropdownItems.length - 1
      )
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (isOpen && activeIndex >= 0 && dropdownItems[activeIndex]) {
        addTag(dropdownItems[activeIndex].tag)
      } else if (trimmedQuery) {
        addTag(trimmedQuery)
      }
    } else if (e.key === ',') {
      e.preventDefault()
      if (trimmedQuery) {
        addTag(trimmedQuery)
      }
    } else if (e.key === 'Backspace' && !query && tags.length > 0) {
      e.preventDefault()
      removeTag(tags[tags.length - 1])
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  return (
    <div className={cn('space-y-1.5', className)} ref={containerRef}>
      {label && (
        <div className="flex items-center justify-between">
          <label
            htmlFor={inputId}
            className="block text-xs font-bold uppercase tracking-wider text-sb-ink-muted"
          >
            {label}
          </label>
          <span className="text-[11px] text-sb-ink-muted">
            {tags.length}/{maxTags}
          </span>
        </div>
      )}

      {/* Input container with chips */}
      <div
        onClick={() => inputRef.current?.focus()}
        className={cn(
          'relative min-h-11 w-full rounded-xl border bg-surface-1 px-3 py-2 text-sm text-sb-ink font-medium shadow-xs transition-[border-color,box-shadow] duration-150',
          disabled
            ? 'cursor-not-allowed opacity-60 border-sb-hairline'
            : isOpen
            ? 'border-brand-500 ring-2 ring-brand-500/25'
            : 'border-sb-hairline hover:border-brand-500/40 cursor-text'
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Selected tag chips */}
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-lg border border-brand-500/25 bg-brand-500/10 px-2.5 py-0.5 text-xs font-semibold text-brand-700 transition-colors animate-fade-in"
            >
              <TagIcon className="h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />
              <span>#{tag}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeTag(tag)
                  }}
                  aria-label={`Remove tag ${tag}`}
                  className="rounded-full p-0.5 hover:bg-brand-500/20 text-brand-700/80 hover:text-brand-900 focus:outline-none"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </span>
          ))}

          {/* Input field */}
          {tags.length < maxTags && (
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              value={query}
              disabled={disabled}
              onChange={(e) => {
                setQuery(e.target.value)
                setIsOpen(true)
              }}
              onFocus={() => setIsOpen(true)}
              onKeyDown={handleKeyDown}
              placeholder={tags.length === 0 ? placeholder : 'Add more...'}
              className="min-w-[120px] flex-1 bg-transparent py-0.5 text-sm text-sb-ink placeholder:text-sb-ink-muted/70 focus:outline-none"
              role="combobox"
              aria-expanded={isOpen}
              aria-autocomplete="list"
              aria-controls={`${inputId}-dropdown`}
            />
          )}
        </div>
      </div>

      {/* Autocomplete dropdown menu */}
      {isOpen && !disabled && dropdownItems.length > 0 && (
        <div
          id={`${inputId}-dropdown`}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full max-w-sm overflow-auto rounded-xl border border-sb-hairline bg-surface-1 p-1.5 shadow-xl animate-fade-in"
          style={{ minWidth: '240px' }}
        >
          {loadingTags && (
            <div className="px-3 py-2 text-xs text-sb-ink-muted">
              Loading past tags...
            </div>
          )}

          {dropdownItems.map((item, index) => {
            const isSelected = index === activeIndex
            return (
              <div
                key={`${item.type}-${item.tag}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => addTag(item.tag)}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
                  isSelected
                    ? 'bg-brand-500/10 text-brand-700 font-semibold'
                    : 'text-sb-ink hover:bg-surface-2'
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {item.type === 'create' ? (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-brand-500/20 text-brand-700">
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  ) : (
                    <TagIcon className="h-3.5 w-3.5 shrink-0 text-sb-ink-muted" aria-hidden="true" />
                  )}
                  <span className="truncate">
                    {item.type === 'create' ? (
                      <>
                        Create tag <span className="font-bold text-brand-700">"{item.tag}"</span>
                      </>
                    ) : (
                      <>#{item.tag}</>
                    )}
                  </span>
                </div>
                {item.type === 'existing' && (
                  <span className="text-[10px] uppercase font-bold text-sb-ink-muted">
                    History
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-[11px] text-sb-ink-muted">
        Press <kbd className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px] text-sb-ink">Enter</kbd> or{' '}
        <kbd className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px] text-sb-ink">,</kbd> to add. Tags group expenses across categories (e.g. for trips or projects).
      </p>
    </div>
  )
}
