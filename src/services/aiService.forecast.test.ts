import { describe, it, expect } from 'vitest'
import { generateForecast } from './aiService'

/** A YYYY-MM-DD in the middle of the month `back` months before this one. */
const monthsAgo = (back: number) => {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - back, 15)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`
}

const row = (back: number, type: 'credit' | 'debit', amount: number) => ({
  type,
  amount,
  date: monthsAgo(back),
  category: type === 'credit' ? 'Salary' : 'Food',
})

/** Flat 1,00,000 income / 50,000 expenses across the five completed months. */
const flatHistory = () => {
  const rows = []
  for (let back = 5; back >= 1; back--) {
    rows.push(row(back, 'credit', 100000), row(back, 'debit', 50000))
  }
  return rows
}

describe('generateForecast — the partial current month', () => {
  it('ignores the month in progress instead of weighting it most heavily', () => {
    const baseline = generateForecast(flatHistory())
    const withPartial = generateForecast([...flatHistory(), row(0, 'debit', 2000)])

    expect(withPartial).toEqual(baseline)
  })

  it('holds a flat history flat', () => {
    const [first] = generateForecast(flatHistory())
    expect(first.forecastIncome).toBeCloseTo(100000, 5)
    expect(first.forecastExpenses).toBeCloseTo(50000, 5)
  })

  it('returns nothing when fewer than two completed months carry data', () => {
    expect(generateForecast([row(1, 'debit', 5000), row(0, 'debit', 90000)])).toEqual([])
  })
})

describe('generateForecast — recency weights', () => {
  it('keeps each month\'s weight when an earlier month is empty', () => {
    // Expenses 10k/20k/30k/40k/50k over months -5..-1, with month -4 blanked.
    // Weights come from calendar position (1, 1.5, 2, 2.5, 3), so the three
    // most recent months keep 2 / 2.5 / 3 rather than sliding down to
    // 1.5 / 2 / 2.5 the way index-into-the-filtered-list did.
    const rows = [
      row(5, 'debit', 10000), row(5, 'credit', 100000),
      row(3, 'debit', 30000), row(3, 'credit', 100000),
      row(2, 'debit', 40000), row(2, 'credit', 100000),
      row(1, 'debit', 50000), row(1, 'credit', 100000),
    ]
    const forecast = generateForecast(rows)

    // (10000*1 + 30000*2 + 40000*2.5 + 50000*3) / (1+2+2.5+3) = 37647.06
    const weightedAvg = 320000 / 8.5
    // Slope across the last three months: (50000 - 30000) / 2 gaps = 10000
    expect(forecast[0].forecastExpenses).toBeCloseTo(weightedAvg + 10000 * 1 * 0.9, 4)
    expect(forecast[1].forecastExpenses).toBeCloseTo(weightedAvg + 10000 * 2 * 0.8, 4)
    expect(forecast[2].forecastExpenses).toBeCloseTo(weightedAvg + 10000 * 3 * 0.7, 4)
    expect(forecast[0].forecastIncome).toBeCloseTo(100000, 4)
  })
})

describe('generateForecast — trend slope', () => {
  it('divides the rise by the gaps between months, not the month count', () => {
    // 30k -> 40k -> 50k is a true 10,000/month climb. Dividing by 3 instead
    // of 2 reported it as 6,667.
    const rows = [
      row(3, 'debit', 30000), row(2, 'debit', 40000), row(1, 'debit', 50000),
    ]
    const forecast = generateForecast(rows)
    // weights 2 / 2.5 / 3 -> (60000 + 100000 + 150000) / 7.5 = 41333.33
    const weightedAvg = 310000 / 7.5
    expect(forecast[0].forecastExpenses).toBeCloseTo(weightedAvg + 10000 * 1 * 0.9, 4)
  })
})
