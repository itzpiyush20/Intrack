/** One character of a formatted figure, as `RollingNumber` renders it. */
export interface RollingToken {
  /**
   * Stable slot identity, independent of how many digits are on either side.
   * Integer-part characters (including the currency symbol, minus sign and
   * thousands separators) are keyed `i0`, `i1`, ... counting leftward from
   * the decimal point — or from the end of the string when there is no
   * decimal point — so adding or removing a fractional part never reshuffles
   * them. Fractional-part characters are keyed `f0`, `f1`, ... counting
   * rightward from the point. The point itself is keyed `dot`.
   */
  key: string
  char: string
  /** 0–9 for a digit that rolls; null for ₹, commas, dots, minus signs. */
  digit: number | null
}

export function splitForRolling(text: string): RollingToken[] {
  const chars = [...text]
  const dotIndex = chars.indexOf('.')
  const integerLength = dotIndex === -1 ? chars.length : dotIndex
  return chars.map((char, index) => {
    let key: string
    if (index === dotIndex) key = 'dot'
    else if (index < integerLength) key = `i${integerLength - 1 - index}`
    else key = `f${index - integerLength - 1}`
    return {
      key,
      char,
      digit: /^[0-9]$/.test(char) ? Number(char) : null,
    }
  })
}
