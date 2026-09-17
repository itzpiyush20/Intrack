// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import Modal from './Modal'

describe('Modal origin', () => {
  afterEach(() => cleanup())

  it('grows from the opener: transform-origin is pinned to the origin point', () => {
    // jsdom lays nothing out, so the panel box is 0x0 at (0, 0) and the
    // transform-origin equals the origin itself.
    render(
      <Modal isOpen onClose={() => {}} title="Add Transaction" origin={{ x: 120, y: 640 }}>
        body
      </Modal>,
    )
    expect(screen.getByRole('dialog').style.transformOrigin).toBe('120px 640px')
  })

  it('keeps the plain rise when no origin is given', () => {
    render(
      <Modal isOpen onClose={() => {}} title="Add Transaction">
        body
      </Modal>,
    )
    expect(screen.getByRole('dialog').style.transformOrigin).toBe('')
  })
})
