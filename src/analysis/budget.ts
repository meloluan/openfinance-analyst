import type { DomainTransaction, Period } from '../domain.js'
import { applyOverrides, type Override } from './categories.js'
import { daysBetween } from './period.js'
import { isExpense, round2 } from './spending.js'

export type Budget = { category: string; amount: number }

export type BudgetLine = {
  category: string
  budget: number
  spent: number
  /** gasto estimado no fim do período, extrapolando o ritmo atual */
  projected: number
  remaining: number
  willExceed: boolean
}

/**
 * Realizado vs meta, com projeção linear pelo ritmo do período.
 *
 * `today` fora do período significa período encerrado: aí não há o que
 * projetar, o realizado já é o final.
 */
export function budgetStatus(
  txs: DomainTransaction[],
  budgets: Budget[],
  period: Period,
  today: string,
  overrides: Override[],
): BudgetLine[] {
  const spentByCategory = new Map<string, number>()
  for (const tx of txs) {
    if (!isExpense(tx)) continue
    const category = applyOverrides(tx, overrides)
    spentByCategory.set(category, (spentByCategory.get(category) ?? 0) + -tx.amount)
  }

  const totalDays = daysBetween(period.from, period.to)
  const withinPeriod = today >= period.from && today <= period.to
  const elapsedDays = withinPeriod ? daysBetween(period.from, today) : totalDays

  return budgets.map(({ category, amount }) => {
    const spent = round2(spentByCategory.get(category) ?? 0)
    const projected =
      withinPeriod && elapsedDays > 0 ? round2((spent / elapsedDays) * totalDays) : spent
    return {
      category,
      budget: amount,
      spent,
      projected,
      remaining: round2(amount - spent),
      willExceed: projected > amount,
    }
  })
}
