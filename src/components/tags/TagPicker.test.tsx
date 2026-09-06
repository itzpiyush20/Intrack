// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import TagPicker from './TagPicker'

describe('TagPicker', () => {
  const mockOnChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders existing tags as chips with # prefix', () => {
    render(
      <TagPicker
        tags={['Goa Trip 2026', 'Wedding']}
        onChange={mockOnChange}
      />
    )

    expect(screen.getByText('#Goa Trip 2026')).toBeDefined()
    expect(screen.getByText('#Wedding')).toBeDefined()
  })

  it('calls onChange with updated array when a tag chip is removed', () => {
    render(
      <TagPicker
        tags={['Goa Trip 2026', 'Wedding']}
        onChange={mockOnChange}
      />
    )

    const removeBtn = screen.getByLabelText('Remove tag Wedding')
    fireEvent.click(removeBtn)

    expect(mockOnChange).toHaveBeenCalledWith(['Goa Trip 2026'])
  })

  it('shows autocomplete dropdown with matching tags and allows selecting one', () => {
    render(
      <TagPicker
        tags={[]}
        onChange={mockOnChange}
        availableTags={['Goa Trip 2026', 'Kitchen Renovation', 'Flight']}
      />
    )

    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Goa' } })

    const option = screen.getByText('#Goa Trip 2026')
    expect(option).toBeDefined()

    fireEvent.click(option)
    expect(mockOnChange).toHaveBeenCalledWith(['Goa Trip 2026'])
  })

  it('shows "Create tag" option for custom new tag and adds on Enter', () => {
    render(
      <TagPicker
        tags={['Goa Trip 2026']}
        onChange={mockOnChange}
        availableTags={['Goa Trip 2026']}
      />
    )

    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Housewarming' } })

    expect(screen.getByText(/Create tag/)).toBeDefined()

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    expect(mockOnChange).toHaveBeenCalledWith(['Goa Trip 2026', 'Housewarming'])
  })

  it('adds tag when comma is pressed', () => {
    render(
      <TagPicker
        tags={[]}
        onChange={mockOnChange}
        availableTags={[]}
      />
    )

    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Party' } })
    fireEvent.keyDown(input, { key: ',', code: 'Comma' })

    expect(mockOnChange).toHaveBeenCalledWith(['Party'])
  })

  it('does not add duplicate tags case-insensitively', () => {
    render(
      <TagPicker
        tags={['Goa Trip 2026']}
        onChange={mockOnChange}
        availableTags={['Goa Trip 2026']}
      />
    )

    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'goa trip 2026' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(mockOnChange).not.toHaveBeenCalled()
  })
})
