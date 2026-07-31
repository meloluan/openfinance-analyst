import type { DomainTransaction } from '../domain.js'
import type { Override } from './categories.js'
import { monthOf } from './period.js'
import { round2, spendingByCategory, type CategoryTotal } from './spending.js'

export type Bill = {
  month: string
  total: number
  byCategory: CategoryTotal[]
  transactionCount: number
}

/**
 * Composição da fatura de um mês.
 *
 * `billForecastDate` é o mês em que a instituição diz que a compra será
 * cobrada — mais confiável que a data da compra, porque compra depois do
 * fechamento cai na fatura seguinte. Sem ele, cai para o mês da transação.
 */
export function billComposition(
  txs: DomainTransaction[],
  billMonth: string,
  overrides: Override[],
): Bill {
  const inBill = txs.filter((tx) => (tx.billForecastDate ?? monthOf(tx.date)) === billMonth)
  const expenses = inBill.filter((tx) => tx.amount < 0)

  return {
    month: billMonth,
    total: round2(expenses.reduce((sum, tx) => sum + -tx.amount, 0)),
    byCategory: spendingByCategory(inBill, overrides),
    transactionCount: expenses.length,
  }
}
