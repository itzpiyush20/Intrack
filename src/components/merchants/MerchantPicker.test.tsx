// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
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

  it('remembers the typed spelling as an alias when it differs', async () => {
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'swi', merchantId: null }} onChange={vi.fn()} />)
    fireEvent.focus(screen.getByLabelText('Merchant'))
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Swiggy/ }))
    expect(addMerchantAlias).toHaveBeenCalledWith('u1', SWIGGY, 'swi')
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
})
