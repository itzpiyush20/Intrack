import { describe, expect, it } from 'vitest'
import { pickHighlightId } from './rowHighlight'

const rows = [{ id: 'new' }, { id: 'a' }, { id: 'b' }]

describe('pickHighlightId', () => {
  it('tints nothing when no save is pending', () => {
    expect(pickHighlightId(null, rows)).toBeNull()
  })

  it('tints the row an add brought in', () => {
    expect(pickHighlightId({ kind: 'added', knownIds: new Set(['a', 'b']) }, rows)).toBe('new')
  })

  it('tints nothing when the added row is outside the selected range', () => {
    expect(pickHighlightId({ kind: 'added', knownIds: new Set(['new', 'a', 'b']) }, rows)).toBeNull()
  })

  it('tints the edited row', () => {
    expect(pickHighlightId({ kind: 'edited', id: 'b' }, rows)).toBe('b')
  })

  it('tints nothing when the edit moved the row out of the range', () => {
    expect(pickHighlightId({ kind: 'edited', id: 'gone' }, rows)).toBeNull()
  })
})
