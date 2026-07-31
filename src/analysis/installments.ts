import type { DomainTransaction } from '../domain.js'
import { addMonths, monthOf } from './period.js'
import { round2 } from './spending.js'

export type FutureInstallment = {
  description: string
  amount: number
  /** parcela que cai neste mês, ex.: 4 de 12 */
  installment: number
  total: number
  /** true quando a linha não veio da instituição e foi inferida */
  projected: boolean
}

export type OutlookMonth = {
  month: string
  committed: number
  items: FutureInstallment[]
}

/**
 * Remove o marcador de parcela que a instituição embute na descrição
 * ("AMAZONMKTPLC*WEBCO10/12" → "AMAZONMKTPLC*WEBCO").
 *
 * Sem isso, cada parcela da mesma compra tem uma descrição diferente e vira um
 * parcelamento distinto — cada um projetando a própria cauda, inflando o
 * comprometimento em várias vezes.
 */
export function stripInstallmentSuffix(description: string): string {
  return description.replace(/\s*\d{1,3}\/\d{1,3}\s*$/, '').trim()
}

/**
 * Identidade de um parcelamento. A instituição não dá um id de compra, então
 * agrupamos por lojista + total de parcelas + valor da parcela. Duas compras
 * distintas no mesmo lojista, com o mesmo número de parcelas e exatamente o
 * mesmo valor, colidiriam — raro o bastante para não valer mais complexidade.
 */
const planKey = (tx: DomainTransaction): string =>
  `${tx.merchantName ?? stripInstallmentSuffix(tx.description)}|${tx.installmentTotal}|${Math.abs(tx.amount)}`

const billMonthOf = (tx: DomainTransaction): string => tx.billForecastDate ?? monthOf(tx.date)

/**
 * Quanto já está comprometido nos próximos meses.
 *
 * O Open Finance devolve **cada parcela como uma transação própria**, inclusive
 * as futuras (PENDING, datadas à frente, com billForecastDate). Então o trabalho
 * aqui é ler o que já existe — não projetar em cima, o que contaria em dobro.
 *
 * A projeção sobrou só para o caso da instituição não mandar a cauda: se o maior
 * número de parcela visto for menor que o total, as que faltam são inferidas a
 * partir do mês da última conhecida, e vêm marcadas com `projected: true`.
 *
 * @param months horizonte em meses
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

  const installments = txs.filter(
    (tx) => tx.installmentNumber !== null && tx.installmentTotal !== null && tx.amount < 0,
  )

  const add = (month: string, item: FutureInstallment): void => {
    const slot = byMonth.get(month)
    if (!slot) return // fora do horizonte pedido
    slot.committed = round2(slot.committed + item.amount)
    slot.items.push(item)
  }

  const plans = new Map<string, DomainTransaction[]>()
  for (const tx of installments) {
    const key = planKey(tx)
    const plan = plans.get(key)
    if (plan) plan.push(tx)
    else plans.set(key, [tx])
  }

  for (const plan of plans.values()) {
    const total = plan[0]!.installmentTotal!
    const amount = Math.abs(plan[0]!.amount)
    const description = stripInstallmentSuffix(plan[0]!.description)

    // 1. As parcelas que a instituição já informou.
    for (const tx of plan) {
      add(billMonthOf(tx), {
        description,
        amount,
        installment: tx.installmentNumber!,
        total,
        projected: false,
      })
    }

    // 2. A cauda que faltar, se faltar.
    const latest = plan.reduce((a, b) => (a.installmentNumber! >= b.installmentNumber! ? a : b))
    const lastKnown = latest.installmentNumber!
    for (let n = lastKnown + 1; n <= total; n++) {
      add(addMonths(billMonthOf(latest), n - lastKnown), {
        description,
        amount,
        installment: n,
        total,
        projected: true,
      })
    }
  }

  return horizon
}
