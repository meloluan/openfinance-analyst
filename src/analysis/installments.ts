import type { DomainTransaction } from '../domain.js'
import { addMonths, monthOf } from './period.js'
import { round2 } from './spending.js'

export type FutureInstallment = {
  description: string
  amount: number
  /** parcela que cairá neste mês, ex.: 4 de 12 */
  installment: number
  total: number
}

export type OutlookMonth = {
  month: string
  committed: number
  items: FutureInstallment[]
}

/**
 * Projeta o que já está comprometido nos próximos meses.
 *
 * Para uma compra `n de N`, as parcelas `n+1..N` caem nos meses seguintes ao
 * da compra. É o que responde "quanto do meu agosto já está vendido".
 *
 * @param months quantos meses de horizonte
 * @param fromMonth mês de referência; o horizonte começa no mês seguinte
 */
export function installmentsOutlook(
  txs: DomainTransaction[],
  months: number,
  fromMonth: string,
): OutlookMonth[] {
  const horizon: OutlookMonth[] = Array.from({ length: months }, (_, i) => ({
    month: addMonths(fromMonth, i + 1),
    committed: 0,
    items: [],
  }))
  const byMonth = new Map(horizon.map((m) => [m.month, m]))

  for (const tx of txs) {
    const { installmentNumber: n, installmentTotal: total } = tx
    if (n === null || total === null || n >= total) continue
    if (tx.amount >= 0) continue

    const amount = Math.abs(tx.amount)
    const purchaseMonth = monthOf(tx.date)

    for (let i = 1; i <= total - n; i++) {
      const slot = byMonth.get(addMonths(purchaseMonth, i))
      if (!slot) continue // fora do horizonte pedido
      slot.committed = round2(slot.committed + amount)
      slot.items.push({ description: tx.description, amount, installment: n + i, total })
    }
  }

  return horizon
}
