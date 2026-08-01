import type { AccountKind, DomainTransaction } from '../domain.js'
import { monthOf } from './period.js'
import { round2 } from './spending.js'

/**
 * Categorias que representam dinheiro andando entre contas suas, não receita
 * nem despesa. Pagamento de fatura é o caso crítico: ele aparece como crédito
 * no cartão E como débito na conta. Contar os dois soma o cartão duas vezes,
 * já que as compras do cartão já entraram como gasto.
 */
const INTERNAL_CATEGORIES = new Set([
  'Credit card payment',
  'Same person transfer',
  'Transfer - Internal',
])

/** Investimento é dinheiro guardado, não consumido — e resgate é dinheiro desguardado. */
const INVESTMENT_CATEGORY = 'Investments'

/**
 * Categorias que não são consumo. Exportado para que qualquer visão de "gasto"
 * use o mesmo critério do fluxo de caixa — senão dois painéis da mesma tela
 * se contradizem, um chamando investimento de gasto e o outro de poupança.
 */
export const NON_EXPENSE_CATEGORIES: ReadonlySet<string> = new Set([
  ...INTERNAL_CATEGORIES,
  INVESTMENT_CATEGORY,
])

export type FlowMonth = {
  month: string
  /** entradas de verdade: salário, recebimentos, vendas */
  income: number
  /** gastos de verdade: compras no cartão + despesas da conta */
  expenses: number
  /** income - expenses */
  net: number
  /** saiu da conta para investimento */
  invested: number
  /** voltou do investimento para a conta */
  redeemed: number
  /** movimento entre contas próprias, incluindo pagamento de fatura */
  internal: number
}

export type CashFlowSummary = {
  months: FlowMonth[]
  totals: Omit<FlowMonth, 'month'>
  /** poupança líquida real: invested - redeemed */
  netSaved: number
}

/**
 * Fluxo de caixa mês a mês, separando o que é receita e despesa de verdade do
 * que é apenas dinheiro mudando de lugar.
 *
 * Sem essa separação a conta mente nos dois sentidos: transferência recebida
 * infla a receita, e pagamento de fatura infla a despesa em cima de compras
 * que já foram contadas.
 */
export function cashFlow(
  txs: DomainTransaction[],
  accountKindById: Map<string, AccountKind>,
): CashFlowSummary {
  const byMonth = new Map<string, FlowMonth>()

  const slot = (month: string): FlowMonth => {
    const existing = byMonth.get(month)
    if (existing) return existing
    const created: FlowMonth = {
      month,
      income: 0,
      expenses: 0,
      net: 0,
      invested: 0,
      redeemed: 0,
      internal: 0,
    }
    byMonth.set(month, created)
    return created
  }

  for (const tx of txs) {
    const kind = accountKindById.get(tx.accountId) ?? 'BANK'
    const category = tx.category ?? ''
    const m = slot(monthOf(tx.date))
    const value = Math.abs(tx.amount)

    if (INTERNAL_CATEGORIES.has(category)) {
      m.internal += value
      continue
    }

    if (category === INVESTMENT_CATEGORY) {
      if (tx.amount < 0) m.invested += value
      else m.redeemed += value
      continue
    }

    if (tx.amount < 0) {
      m.expenses += value
    } else if (kind === 'CREDIT') {
      // Crédito no cartão que não é pagamento de fatura é estorno:
      // reduz o gasto, não é receita.
      m.expenses -= value
    } else {
      m.income += value
    }
  }

  const months = [...byMonth.values()]
    .map((m) => ({
      ...m,
      income: round2(m.income),
      expenses: round2(m.expenses),
      invested: round2(m.invested),
      redeemed: round2(m.redeemed),
      internal: round2(m.internal),
      net: round2(m.income - m.expenses),
    }))
    .sort((a, b) => a.month.localeCompare(b.month))

  const sum = (pick: (m: FlowMonth) => number): number =>
    round2(months.reduce((acc, m) => acc + pick(m), 0))

  const totals = {
    income: sum((m) => m.income),
    expenses: sum((m) => m.expenses),
    net: sum((m) => m.net),
    invested: sum((m) => m.invested),
    redeemed: sum((m) => m.redeemed),
    internal: sum((m) => m.internal),
  }

  return { months, totals, netSaved: round2(totals.invested - totals.redeemed) }
}
