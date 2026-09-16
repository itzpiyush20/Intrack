/** One character of a formatted figure, as `RollingNumber` renders it. */
export interface RollingToken {
  /** Position counted from the right, so trailing digits keep their slot. */
  key: string
  char: string
  /** 0–9 for a digit that rolls; null for ₹, commas, dots, minus signs. */
  digit: number | null
}

export function splitForRolling(text: string): RollingToken[] {
  const chars = [...text]
  return chars.map((char, index) => ({
    key: `p${chars.length - 1 - index}`,
    char,
    digit: /^[0-9]$/.test(char) ? Number(char) : null,
  }))
}
