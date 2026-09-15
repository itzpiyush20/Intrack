// @vitest-environment jsdom
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, cleanup, waitFor, createEvent } from '@testing-library/react'
import MerchantPicker, { type MerchantPickerValue } from './MerchantPicker'

const listMerchants = vi.fn()
const createMerchant = vi.fn()
const addMerchantAlias = vi.fn()

vi.mock('@/services/merchants', () => ({
  listMerchants: (...a: unknown[]) => listMerchants(...a),
  createMerchant: (...a: unknown[]) => createMerchant(...a),
  addMerchantAlias: (...a: unknown[]) => addMerchantAlias(...a),
}))

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

vi.mock('@/context/CategoriesContext', () => ({
  useCategories: () => ({
    categories: [
      { id: '1', name: 'Food & Dining', emoji: '🍔' },
      { id: '2', name: 'Shopping', emoji: '🛍️' },
    ],
  }),
}))

const SWIGGY = { id: 'm1', name: 'Swiggy', default_category: 'Food & Dining', aliases: ['swiggy blr'] }
const AMAZON = { id: 'm2', name: 'Amazon', default_category: null, aliases: [] }

function Harness({ onChange }: { onChange: (v: MerchantPickerValue) => void }) {
  return <MerchantPicker id="mp" label="Merchant" value={{ text: '', merchantId: null }} onChange={onChange} />
}

/** Controlled like the real hosts: feeds every onChange back in as the value. */
function Stateful({ onChange, initial = { text: '', merchantId: null } }: {
  onChange: (v: MerchantPickerValue) => void
  initial?: MerchantPickerValue
}) {
  const [value, setValue] = useState<MerchantPickerValue>(initial)
  return (
    <MerchantPicker
      id="mp"
      label="Merchant"
      value={value}
      onChange={(next) => {
        onChange(next)
        setValue(next)
      }}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  listMerchants.mockResolvedValue({ data: [SWIGGY, AMAZON], error: null })
  addMerchantAlias.mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('MerchantPicker', () => {
  it('lists saved merchants matching what is typed', async () => {
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'swi', merchantId: null }} onChange={vi.fn()} />)
    fireEvent.focus(screen.getByLabelText('Merchant'))
    expect(await screen.findByRole('option', { name: /Swiggy/ })).toBeDefined()
    expect(screen.queryByRole('option', { name: /Amazon/ })).toBeNull()
  })

  it('links the merchant and passes its usual category when picked', async () => {
    const onChange = vi.fn()
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'swi', merchantId: null }} onChange={onChange} />)
    fireEvent.focus(screen.getByLabelText('Merchant'))
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Swiggy/ }))
    expect(onChange).toHaveBeenLastCalledWith({ text: 'Swiggy', merchantId: 'm1', defaultCategory: 'Food & Dining' })
  })

  it('picking never saves a spelling', async () => {
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'swi', merchantId: null }} onChange={vi.fn()} />)
    fireEvent.focus(screen.getByLabelText('Merchant'))
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Swiggy/ }))
    expect(addMerchantAlias).not.toHaveBeenCalled()
  })

  it('does not link an initial value when the saved list arrives', async () => {
    const onChange = vi.fn()
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'Swiggy', merchantId: null }} onChange={onChange} />)
    fireEvent.focus(screen.getByLabelText('Merchant'))
    await screen.findByRole('option', { name: /Swiggy/ })
    // Let the post-load effect run before asserting it did nothing.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ merchantId: 'm1' }))
  })

  it('Enter with typed text and no highlighted row lets the host form submit', async () => {
    render(
      <form onSubmit={(e) => e.preventDefault()}>
        <Stateful onChange={vi.fn()} />
      </form>
    )
    const box = screen.getByLabelText('Merchant')
    fireEvent.focus(box)
    await screen.findByRole('option', { name: /Swiggy/ })
    fireEvent.change(box, { target: { value: 'Chai Point' } })
    await screen.findByRole('option', { name: /as a merchant/ })

    const ev = createEvent.keyDown(box, { key: 'Enter' })
    fireEvent(box, ev)
    expect(ev.defaultPrevented).toBe(false)
    expect(screen.queryByLabelText('Merchant name')).toBeNull()
  })

  it('focusing an empty box and pressing Enter links nothing', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const box = screen.getByLabelText('Merchant')
    fireEvent.focus(box)
    await screen.findByRole('option', { name: /Swiggy/ })
    const ev = createEvent.keyDown(box, { key: 'Enter' })
    fireEvent(box, ev)
    expect(ev.defaultPrevented).toBe(false)
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ merchantId: expect.any(String) }))
  })

  it('closes the list when focus leaves', async () => {
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'swi', merchantId: null }} onChange={vi.fn()} />)
    const box = screen.getByLabelText('Merchant')
    fireEvent.focus(box)
    await screen.findByRole('listbox')
    fireEvent.blur(box)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('links on an exact typed name, and unlinks on anything else', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    // Wait until the saved list is in state: with an empty query every merchant shows.
    fireEvent.focus(screen.getByLabelText('Merchant'))
    await screen.findByRole('option', { name: /Swiggy/ })

    fireEvent.change(screen.getByLabelText('Merchant'), { target: { value: 'swiggy blr' } })
    expect(onChange).toHaveBeenLastCalledWith({ text: 'swiggy blr', merchantId: 'm1', defaultCategory: 'Food & Dining' })

    fireEvent.change(screen.getByLabelText('Merchant'), { target: { value: 'Swiggy Instamart' } })
    expect(onChange).toHaveBeenLastCalledWith({ text: 'Swiggy Instamart', merchantId: null, defaultCategory: null })
  })

  it('adds a new merchant through the inline panel and selects it', async () => {
    createMerchant.mockResolvedValue({
      data: { id: 'm3', name: 'Sharma Kirana', default_category: 'Shopping', aliases: [] },
      error: null,
    })
    const onChange = vi.fn()
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'Sharma Kirana', merchantId: null }} onChange={onChange} />)
    fireEvent.focus(screen.getByLabelText('Merchant'))
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Add "Sharma Kirana" as a merchant/ }))

    expect((screen.getByLabelText('Merchant name') as HTMLInputElement).value).toBe('Sharma Kirana')
    fireEvent.change(screen.getByLabelText('Usual category (optional)'), { target: { value: 'Shopping' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save merchant' }))

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ text: 'Sharma Kirana', merchantId: 'm3', defaultCategory: 'Shopping' })
    )
    expect(createMerchant).toHaveBeenCalledWith('u1', 'Sharma Kirana', 'Shopping')
    expect(screen.queryByLabelText('Merchant name')).toBeNull()
  })

  it('does not offer "Add" when the text already is a saved merchant', async () => {
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'Amazon', merchantId: 'm2' }} onChange={vi.fn()} />)
    fireEvent.focus(screen.getByLabelText('Merchant'))
    await screen.findByRole('option', { name: /Amazon/ })
    expect(screen.queryByRole('option', { name: /as a merchant/ })).toBeNull()
  })

  it('still accepts free text when the list fails to load', async () => {
    listMerchants.mockResolvedValue({ data: [], error: { message: 'offline' } })
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Merchant'), { target: { value: 'Chai Point' } })
    expect(onChange).toHaveBeenLastCalledWith({ text: 'Chai Point', merchantId: null, defaultCategory: null })
  })

  // ---- A. Enter never submits the host form from inside the picker ----

  it('Enter in the add panel saves the merchant instead of submitting the host form', async () => {
    createMerchant.mockResolvedValue({ data: { id: 'm3', name: 'Chai Point', default_category: null, aliases: [] }, error: null })
    const submitSpy = vi.fn((e: { preventDefault: () => void }) => e.preventDefault())
    render(
      <form onSubmit={submitSpy}>
        <MerchantPicker id="mp" label="Merchant" value={{ text: 'Chai Point', merchantId: null }} onChange={vi.fn()} />
      </form>
    )
    fireEvent.focus(screen.getByLabelText('Merchant'))
    fireEvent.mouseDown(await screen.findByRole('option', { name: /as a merchant/ }))

    const nameInput = screen.getByLabelText('Merchant name')
    const ev = createEvent.keyDown(nameInput, { key: 'Enter' })
    fireEvent(nameInput, ev)
    expect(ev.defaultPrevented).toBe(true)
    await waitFor(() => expect(createMerchant).toHaveBeenCalledWith('u1', 'Chai Point', null))
    expect(submitSpy).not.toHaveBeenCalled()
  })

  it('Enter on an active option is swallowed; Enter with the list closed reaches the form', async () => {
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'swi', merchantId: null }} onChange={vi.fn()} />)
    const box = screen.getByLabelText('Merchant')
    fireEvent.focus(box)
    await screen.findByRole('option', { name: /Swiggy/ })
    fireEvent.keyDown(box, { key: 'ArrowDown' })

    const open = createEvent.keyDown(box, { key: 'Enter' })
    fireEvent(box, open)
    expect(open.defaultPrevented).toBe(true)

    // The pick closed the list; free-text Enter must now submit normally.
    expect(screen.queryByRole('listbox')).toBeNull()
    const closed = createEvent.keyDown(box, { key: 'Enter' })
    fireEvent(box, closed)
    expect(closed.defaultPrevented).toBe(false)
  })

  // ---- B. Keyboard navigation ----

  it('ArrowDown then Enter picks the first suggestion', async () => {
    const onChange = vi.fn()
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'swi', merchantId: null }} onChange={onChange} />)
    const box = screen.getByLabelText('Merchant')
    fireEvent.focus(box)
    await screen.findByRole('option', { name: /Swiggy/ })
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.keyDown(box, { key: 'ArrowDown' }) // opens on the first option
    expect(box.getAttribute('aria-activedescendant')).toBe('mp-options-0')
    expect(screen.getByRole('option', { name: /Swiggy/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith({ text: 'Swiggy', merchantId: 'm1', defaultCategory: 'Food & Dining' })
  })

  it('ArrowDown past the last suggestion reaches Add, and Enter opens the add panel', async () => {
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'swi', merchantId: null }} onChange={vi.fn()} />)
    const box = screen.getByLabelText('Merchant')
    fireEvent.focus(box)
    await screen.findByRole('option', { name: /Swiggy/ })
    expect(box.hasAttribute('aria-activedescendant')).toBe(false) // nothing active until the user moves

    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(box.getAttribute('aria-activedescendant')).toBe('mp-options-0')
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    expect(box.getAttribute('aria-activedescendant')).toBe('mp-options-1')
    expect(screen.getByRole('option', { name: /as a merchant/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(box, { key: 'ArrowDown' }) // wraps
    expect(box.getAttribute('aria-activedescendant')).toBe('mp-options-0')
    fireEvent.keyDown(box, { key: 'ArrowUp' }) // wraps back to Add
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(screen.getByLabelText('Merchant name')).toBeDefined()
  })

  // ---- C. Shared list ----

  it('uses a merchants prop instead of loading its own list', async () => {
    const onChange = vi.fn()
    render(
      <MerchantPicker id="mp" label="Merchant" merchants={[AMAZON]} value={{ text: '', merchantId: null }} onChange={onChange} />
    )
    fireEvent.focus(screen.getByLabelText('Merchant'))
    expect(await screen.findByRole('option', { name: /Amazon/ })).toBeDefined()
    expect(screen.queryByRole('option', { name: /Swiggy/ })).toBeNull()
    expect(listMerchants).not.toHaveBeenCalled()
  })

  it('reports a newly created merchant through onMerchantAdded', async () => {
    const created = { id: 'm3', name: 'Sharma Kirana', default_category: null, aliases: [] }
    createMerchant.mockResolvedValue({ data: created, error: null })
    const onMerchantAdded = vi.fn()
    render(
      <MerchantPicker
        id="mp"
        label="Merchant"
        merchants={[SWIGGY]}
        onMerchantAdded={onMerchantAdded}
        value={{ text: 'Sharma Kirana', merchantId: null }}
        onChange={vi.fn()}
      />
    )
    fireEvent.focus(screen.getByLabelText('Merchant'))
    fireEvent.mouseDown(await screen.findByRole('option', { name: /as a merchant/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save merchant' }))
    await waitFor(() => expect(onMerchantAdded).toHaveBeenCalledWith(created))
  })

  // ---- D. Robustness ----

  it('shows a generic message and re-enables Save when creating throws', async () => {
    createMerchant.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'Chai Point', merchantId: null }} onChange={vi.fn()} />)
    fireEvent.focus(screen.getByLabelText('Merchant'))
    fireEvent.mouseDown(await screen.findByRole('option', { name: /as a merchant/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save merchant' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save this merchant. Try again.')
    expect((screen.getByRole('button', { name: 'Save merchant' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('caps a long pre-filled name at 80 characters', async () => {
    const longText = 'A'.repeat(100)
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: longText, merchantId: null }} onChange={vi.fn()} />)
    fireEvent.focus(screen.getByLabelText('Merchant'))
    fireEvent.mouseDown(await screen.findByRole('option', { name: /as a merchant/ }))
    expect((screen.getByLabelText('Merchant name') as HTMLInputElement).value.length).toBe(80)
  })

  it('shows the generic message for a database error', async () => {
    createMerchant.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('new row violates check constraint'), { code: '23514' }),
    })
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'Chai Point', merchantId: null }} onChange={vi.fn()} />)
    fireEvent.focus(screen.getByLabelText('Merchant'))
    fireEvent.mouseDown(await screen.findByRole('option', { name: /as a merchant/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save merchant' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save this merchant. Try again.')
  })

  it('notes quietly when the saved list returns an error', async () => {
    listMerchants.mockResolvedValue({ data: [], error: { message: 'offline' } })
    render(<Harness onChange={vi.fn()} />)
    expect(await screen.findByText("Saved merchants couldn't load — you can still type a name.")).toBeDefined()
  })

  it('notes quietly when loading the saved list throws', async () => {
    listMerchants.mockRejectedValue(new TypeError('Failed to fetch'))
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    expect(await screen.findByText("Saved merchants couldn't load — you can still type a name.")).toBeDefined()
    fireEvent.change(screen.getByLabelText('Merchant'), { target: { value: 'Chai Point' } })
    expect(onChange).toHaveBeenLastCalledWith({ text: 'Chai Point', merchantId: null, defaultCategory: null })
  })

  it('links a typed name once the saved list arrives', async () => {
    let resolveList: (v: unknown) => void = () => {}
    listMerchants.mockReturnValue(new Promise((r) => (resolveList = r)))
    const onChange = vi.fn()
    render(<Stateful onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('Merchant'), { target: { value: 'swiggy' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith({ text: 'swiggy', merchantId: null, defaultCategory: null })

    await act(async () => resolveList({ data: [SWIGGY, AMAZON], error: null }))
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ text: 'swiggy', merchantId: 'm1', defaultCategory: 'Food & Dining' })
    )
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  // ---- E. ARIA ----

  it('only claims to control the listbox while it is rendered', async () => {
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'swi', merchantId: null }} onChange={vi.fn()} />)
    const box = screen.getByLabelText('Merchant')
    expect(box.getAttribute('aria-expanded')).toBe('false')
    expect(box.hasAttribute('aria-controls')).toBe(false)
    expect(box.hasAttribute('aria-activedescendant')).toBe(false)

    fireEvent.focus(box)
    await screen.findByRole('listbox')
    expect(box.getAttribute('aria-expanded')).toBe('true')
    expect(box.getAttribute('aria-controls')).toBe('mp-options')
  })

  // ---- F. Outside close ----

  it('closes the list on a pointer press outside', async () => {
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'swi', merchantId: null }} onChange={vi.fn()} />)
    fireEvent.focus(screen.getByLabelText('Merchant'))
    await screen.findByRole('listbox')
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  // ---- G. Hidden label ----

  it('keeps an accessible name without a visible label when hideLabel is set', () => {
    render(<MerchantPicker id="mp" label="Merchant" hideLabel value={{ text: '', merchantId: null }} onChange={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: 'Merchant' })).toBeDefined()
    expect(document.querySelector('label')).toBeNull()
  })
})
