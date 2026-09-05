import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpcMock = vi.fn()
const fromMock = vi.fn()
vi.mock('./supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
  },
}))

import {
  getCategories,
  createCategory,
  updateCategoryStyle,
  renameCategory,
  deleteCategory,
  getCategoryUsage,
} from './categories'

beforeEach(() => {
  rpcMock.mockReset()
  fromMock.mockReset()
})

describe('getCategories', () => {
  it('fetches categories for the current user ordered by sort_order', async () => {
    const order = vi.fn().mockResolvedValue({ data: [{ id: 'c1', name: 'Food' }], error: null })
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq })
    fromMock.mockReturnValue({ select })

    const { data, error } = await getCategories()

    expect(fromMock).toHaveBeenCalledWith('categories')
    expect(select).toHaveBeenCalledWith('*')
    expect(eq).toHaveBeenCalledWith('user_id', 'u1')
    expect(order).toHaveBeenCalledWith('sort_order', { ascending: true })
    expect(data).toEqual([{ id: 'c1', name: 'Food' }])
    expect(error).toBeNull()
  })
})

describe('createCategory', () => {
  it('inserts a new category scoped to the current user', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'c2', name: 'Travel' }, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    fromMock.mockReturnValue({ insert })

    const input = { name: 'Travel', emoji: '✈️', color: '#000', type: 'expense' as const, budget_eligible: true }
    const { data, error } = await createCategory(input)

    expect(fromMock).toHaveBeenCalledWith('categories')
    expect(insert).toHaveBeenCalledWith({ user_id: 'u1', ...input })
    expect(data).toEqual({ id: 'c2', name: 'Travel' })
    expect(error).toBeNull()
  })
})

describe('updateCategoryStyle', () => {
  it('updates emoji/color/type/budget_eligible for a category by id', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'c1', emoji: '🍔' }, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const eq = vi.fn().mockReturnValue({ select })
    const update = vi.fn().mockReturnValue({ eq })
    fromMock.mockReturnValue({ update })

    const { data, error } = await updateCategoryStyle('c1', { emoji: '🍔' })

    expect(fromMock).toHaveBeenCalledWith('categories')
    expect(update).toHaveBeenCalledWith({ emoji: '🍔' })
    expect(eq).toHaveBeenCalledWith('id', 'c1')
    expect(data).toEqual({ id: 'c1', emoji: '🍔' })
    expect(error).toBeNull()
  })
})

describe('renameCategory', () => {
  it('calls the rename_category RPC with old and new names', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null })
    const { error } = await renameCategory('Food & Dining', 'Eating Out')
    expect(rpcMock).toHaveBeenCalledWith('rename_category', {
      old_name: 'Food & Dining',
      new_name: 'Eating Out',
    })
    expect(error).toBeNull()
  })

  it('surfaces a duplicate-name error from the RPC', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'duplicate key value violates unique constraint' } })
    const { error } = await renameCategory('A', 'B')
    expect(error).not.toBeNull()
  })
})

describe('deleteCategory', () => {
  it('calls the delete_category RPC and returns impact counts', async () => {
    rpcMock.mockResolvedValue({
      data: [{ moved_transactions: 4, deleted_budgets: 1, fallback_name: 'Other' }],
      error: null,
    })
    const { data, error } = await deleteCategory('Travel')
    expect(rpcMock).toHaveBeenCalledWith('delete_category', { cat_name: 'Travel' })
    expect(data).toEqual({ moved_transactions: 4, deleted_budgets: 1, fallback_name: 'Other' })
    expect(error).toBeNull()
  })
})

describe('getCategoryUsage', () => {
  it('counts transactions and budgets referencing the category', async () => {
    const txEq = vi.fn().mockResolvedValue({ count: 4, error: null })
    const txSelect = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: txEq }) })
    // The budgets count filters out deleted rows (migration 043 tombstones),
    // so the chain ends in .is('deleted_at', null) rather than the second .eq.
    const budgetsIs = vi.fn().mockResolvedValue({ count: 1, error: null })
    const budgetsEq = vi.fn().mockReturnValue({ is: budgetsIs })
    const budgetsSelect = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: budgetsEq }) })

    fromMock.mockImplementationOnce(() => ({ select: txSelect })).mockImplementationOnce(() => ({ select: budgetsSelect }))

    const { data, error } = await getCategoryUsage('Travel')

    expect(fromMock).toHaveBeenCalledWith('transactions')
    expect(fromMock).toHaveBeenCalledWith('budgets')
    expect(budgetsIs).toHaveBeenCalledWith('deleted_at', null)
    expect(data).toEqual({ transactions: 4, budgets: 1 })
    expect(error).toBeNull()
  })
})
