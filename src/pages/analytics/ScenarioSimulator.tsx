import { Card } from '@/components/ui'
import { formatCurrency } from '@/utils'
import { Sliders, CheckCircle2, AlertCircle } from 'lucide-react'

interface ScenarioSimulatorProps {
  simSalary: number
  setSimSalary: (val: number) => void
  simWants: number
  setSimWants: (val: number) => void
  totalIncome: number
  wantsSpent: number
  needsSpent: number
}

export function ScenarioSimulator({
  simSalary,
  setSimSalary,
  simWants,
  setSimWants,
  totalIncome,
  wantsSpent,
  needsSpent,
}: ScenarioSimulatorProps) {
  const simulatedSavings = Math.max(0, simSalary - needsSpent - simWants)
  const simSavingsPct = simSalary > 0 ? Math.round((simulatedSavings / simSalary) * 100) : 0

  return (
    <Card className="relative overflow-hidden bg-surface-1 border border-sb-hairline shadow-card rounded-2xl p-5 flex flex-col justify-between h-full before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-brand-500/30 before:to-transparent">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Sliders className="w-5 h-5 text-brand-600 shrink-0" />
          <h2 className="text-base font-bold text-sb-ink">Budget Scenario Simulator</h2>
        </div>
        <p className="text-xs text-sb-ink-muted mb-6 leading-relaxed">
          Slide your income or discretionary wants to simulate your monthly savings targets.
        </p>

        <div className="space-y-6">
          <div>
            <div className="flex justify-between text-xs mb-2">
              <span className="text-sb-ink-muted font-semibold">Simulated Monthly Income</span>
              <span className="font-bold text-brand-700">{formatCurrency(simSalary)}</span>
            </div>
            <input
              type="range"
              min={Math.max(10000, totalIncome - 50000)}
              max={totalIncome + 100000 || 200000}
              step={5000}
              value={simSalary}
              onChange={(e) => setSimSalary(Number(e.target.value))}
              className="w-full accent-brand-600 h-1.5 bg-surface-2 rounded-lg cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-brand-600 [&::-webkit-slider-thumb]:shadow-xs [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-brand-600"
            />
          </div>

          <div>
            <div className="flex justify-between text-xs mb-2">
              <span className="text-sb-ink-muted font-semibold">Simulated Leisure / Wants Outflow</span>
              <span className="font-bold text-[var(--status-warning-text)]">{formatCurrency(simWants)}</span>
            </div>
            <input
              type="range"
              min={1000}
              max={Math.max(10000, wantsSpent + 30000)}
              step={1000}
              value={simWants}
              onChange={(e) => setSimWants(Number(e.target.value))}
              className="w-full accent-brand-600 h-1.5 bg-surface-2 rounded-lg cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-brand-600 [&::-webkit-slider-thumb]:shadow-xs [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-brand-600"
            />
          </div>
        </div>
      </div>

      <div className="mt-8 p-4 border border-brand-200/80 bg-brand-50/50 rounded-2xl flex flex-col gap-3 shadow-xs">
        <div className="flex items-center justify-between text-xs">
          <span className="text-sb-ink-muted font-semibold">Simulated Monthly Savings</span>
          <span className="font-extrabold text-[var(--status-positive-text)] text-sm">
            {formatCurrency(simulatedSavings)} ({simSavingsPct}%)
          </span>
        </div>
        <div className="text-xs text-sb-ink-secondary leading-relaxed flex items-start gap-1.5">
          {simSavingsPct >= 20 ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--status-positive-text)] shrink-0 mt-0.5" />
              <span>Adheres fully to the 20% compounding baseline. At this rate, your emergency reserve is secure.</span>
            </>
          ) : (
            <>
              <AlertCircle className="w-3.5 h-3.5 text-[var(--status-danger-text)] shrink-0 mt-0.5" />
              <span>Below the 20% savings baseline. Try reducing wants or finding tax deductions to buffer savings.</span>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}

export default ScenarioSimulator
