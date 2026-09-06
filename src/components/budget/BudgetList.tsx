import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { EmptyState, Skeleton, staggerParent } from '@/components/ui'
import BudgetCard from './BudgetCard'

export interface BudgetListSource {
  id: string
  month: string
}

export interface BudgetListItem {
  id: string
  category: string
  amount: number
  month?: string
  monthCount?: number
  rows?: BudgetListSource[]
}

export interface BudgetListProps {
  budgets: BudgetListItem[]
  spentMap: Record<string, number>
  rolloverMap?: Record<string, number>
  getCategoryStyle: (category: string) => { label: string; emoji: string; color: string }
  isCurrentMonth: boolean
  daysElapsed: number
  loading?: boolean
  actionLoading?: boolean
  onDeleteBudget?: (target: {
    rows: BudgetListSource[]
    categoryLabel: string
    monthCount: number
  }) => void
}

export default function BudgetList({
  budgets,
  spentMap,
  rolloverMap = {},
  getCategoryStyle,
  isCurrentMonth,
  daysElapsed,
  loading = false,
  actionLoading = false,
  onDeleteBudget,
}: BudgetListProps) {
  const reduceMotion = useReducedMotion()

  if (loading) {
    return (
      <ul role="status" aria-label="Loading your budgets" className="space-y-5">
        {[0, 1, 2].map((i) => (
          <li key={i} className="space-y-2.5">
            <div className="flex items-center gap-3">
              <Skeleton shape="block" className="h-10 w-10 shrink-0 rounded-xl" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32 max-w-full" />
                <Skeleton className="h-3 w-24 max-w-full" />
              </div>
              <div className="hidden w-32 space-y-1.5 sm:block">
                <Skeleton className="ml-auto h-4 w-24" />
                <Skeleton className="ml-auto h-3 w-20" />
              </div>
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </li>
        ))}
      </ul>
    )
  }

  if (budgets.length === 0) {
    return (
      <EmptyState
        icon="🎯"
        title="No limits set yet"
        description="Pick a category and a monthly cap to start. Intrack tells you where you stand as the month goes on, and warns you before you pass it."
      />
    )
  }

  return (
    <motion.ul
      className="divide-y divide-sb-hairline"
      variants={staggerParent(reduceMotion, budgets.length)}
      initial="initial"
      animate="animate"
    >
      <AnimatePresence initial={false}>
        {budgets.map((budget) => {
          const cat = getCategoryStyle(budget.category)
          const spent = spentMap[budget.category] || 0
          const rolloverSurplus = rolloverMap[budget.category] || 0

          return (
            <BudgetCard
              key={budget.id}
              budget={budget}
              categoryStyle={cat}
              spent={spent}
              rolloverSurplus={rolloverSurplus}
              isCurrentMonth={isCurrentMonth}
              daysElapsed={daysElapsed}
              actionLoading={actionLoading}
              reduceMotion={Boolean(reduceMotion)}
              onDelete={
                onDeleteBudget
                  ? () =>
                      onDeleteBudget({
                        rows: budget.rows ?? [{ id: budget.id, month: budget.month || '' }],
                        categoryLabel: cat.label,
                        monthCount: budget.monthCount ?? 1,
                      })
                  : undefined
              }
            />
          )
        })}
      </AnimatePresence>
    </motion.ul>
  )
}
