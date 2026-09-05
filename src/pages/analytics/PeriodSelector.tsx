// Ordered shortest window to longest, matching the order they are offered in
// the dropdown below. The union order carries no behaviour — getRangeDates
// branches on the value — but keeping the two in step stops them drifting apart.
export type RangeType = 'this-week' | 'last-week' | 'last-15-days' | 'this-month' | 'last-month' | 'last-6-months';

interface PeriodSelectorProps {
  value: RangeType
  onChange: (value: RangeType) => void
  id?: string
}

export function PeriodSelector({ value, onChange, id }: PeriodSelectorProps) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as RangeType)}
      className="bg-surface-1 border border-sb-hairline text-sb-ink text-base md:text-xs font-semibold rounded-xl px-3 py-2.5 md:py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/25 focus:border-brand-500 cursor-pointer shadow-xs hover:border-brand-500/40 transition-all"
    >
      {/* Shortest window first, longest last. */}
      <option value="this-week">This Week</option>
      <option value="last-week">Last Week</option>
      <option value="last-15-days">Last 15 Days</option>
      <option value="this-month">This Month</option>
      <option value="last-month">Last Month</option>
      <option value="last-6-months">Last 6 Months</option>
    </select>
  )
}

export default PeriodSelector
