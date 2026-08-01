import type { DomainTransaction } from '../domain.js'
import { applyOverrides, type Override } from './categories.js'
import { monthOf } from './period.js'

export type CategoryTotal = { category: string; total: number; count: number }
export type MonthTotal = { month: string; total: number }
export type CategoryComparison = {
  category: string
  current: number
  previous: number
  delta: number
  /** null quando o período anterior é zero — não há percentual a calcular */
  deltaPct: number | null
}

/** Gasto é negativo no domínio; aqui vira positivo porque é assim que se lê um relatório. */
export const isExpense = (tx: DomainTransaction): boolean => tx.amount < 0
const expenseValue = (tx: DomainTransaction): number => -tx.amount

export const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Mediana. Para valor mensal ela resiste a um mês atípico que a média não
 * resiste — um mês de receita excepcional distorce a média o ano inteiro.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

export function spendingByCategory(
  txs: DomainTransaction[],
  overrides: Override[],
): CategoryTotal[] {
  const acc = new Map<string, { total: number; count: number }>()
  for (const tx of txs) {
    if (!isExpense(tx)) continue
    const category = applyOverrides(tx, overrides)
    const entry = acc.get(category) ?? { total: 0, count: 0 }
    entry.total += expenseValue(tx)
    entry.count += 1
    acc.set(category, entry)
  }
  return [...acc.entries()]
    .map(([category, v]) => ({ category, total: round2(v.total), count: v.count }))
    .sort((a, b) => b.total - a.total)
}

export function spendingByMonth(txs: DomainTransaction[]): MonthTotal[] {
  const acc = new Map<string, number>()
  for (const tx of txs) {
    if (!isExpense(tx)) continue
    const month = monthOf(tx.date)
    acc.set(month, (acc.get(month) ?? 0) + expenseValue(tx))
  }
  return [...acc.entries()]
    .map(([month, total]) => ({ month, total: round2(total) }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

export function comparePeriods(
  current: DomainTransaction[],
  previous: DomainTransaction[],
  overrides: Override[],
): CategoryComparison[] {
  const cur = new Map(spendingByCategory(current, overrides).map((r) => [r.category, r.total]))
  const prev = new Map(spendingByCategory(previous, overrides).map((r) => [r.category, r.total]))

  // União das categorias: o que sumiu de um mês para o outro é informação também.
  return [...new Set([...cur.keys(), ...prev.keys()])]
    .map((category) => {
      const c = cur.get(category) ?? 0
      const p = prev.get(category) ?? 0
      return {
        category,
        current: c,
        previous: p,
        delta: round2(c - p),
        deltaPct: p === 0 ? null : round2(((c - p) / p) * 100),
      }
    })
    .sort((a, b) => b.current - a.current)
}
