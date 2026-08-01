import { describe, it, expect } from 'vitest'
import { cashFlow } from '../../src/analysis/cashflow.js'
import type { AccountKind, DomainTransaction } from '../../src/domain.js'

let seq = 0
const tx = (o: Partial<DomainTransaction>): DomainTransaction => ({
  id: `t${seq++}`,
  accountId: 'conta',
  date: '2026-06-15',
  description: 'X',
  amount: -10,
  currencyCode: 'BRL',
  category: null,
  merchantName: null,
  installmentNumber: null,
  installmentTotal: null,
  billForecastDate: null,
  status: 'POSTED',
  raw: '{}',
  ...o,
})

const KINDS = new Map<string, AccountKind>([
  ['conta', 'BANK'],
  ['cartao', 'CREDIT'],
])

describe('cashFlow', () => {
  it('separa receita de despesa e calcula o líquido', () => {
    const { totals } = cashFlow(
      [
        tx({ amount: 5000, category: 'Salary' }),
        tx({ amount: -1200, category: 'Groceries' }),
        tx({ amount: -800, accountId: 'cartao', category: 'Shopping' }),
      ],
      KINDS,
    )
    expect(totals.income).toBe(5000)
    expect(totals.expenses).toBe(2000)
    expect(totals.net).toBe(3000)
  })

  it('NÃO conta o pagamento de fatura em dobro', () => {
    // A compra no cartão já é o gasto. O pagamento da fatura aparece duas vezes
    // (crédito no cartão + débito na conta) e não pode virar despesa nova.
    const { totals } = cashFlow(
      [
        tx({ amount: -800, accountId: 'cartao', category: 'Shopping' }),
        tx({ amount: 800, accountId: 'cartao', category: 'Credit card payment' }),
        tx({ amount: -800, accountId: 'conta', category: 'Credit card payment' }),
        tx({ amount: 5000, category: 'Salary' }),
      ],
      KINDS,
    )
    expect(totals.expenses).toBe(800) // e não 1600
    expect(totals.income).toBe(5000) // o crédito no cartão não é receita
    expect(totals.internal).toBe(1600)
    expect(totals.net).toBe(4200)
  })

  it('transferência entre contas próprias não vira receita', () => {
    const { totals } = cashFlow(
      [
        tx({ amount: 3000, category: 'Same person transfer' }),
        tx({ amount: 2000, category: 'Transfer - Internal' }),
        tx({ amount: 5000, category: 'Salary' }),
      ],
      KINDS,
    )
    expect(totals.income).toBe(5000)
    expect(totals.internal).toBe(5000)
  })

  it('investimento é poupança, não despesa; resgate é despoupança, não receita', () => {
    const r = cashFlow(
      [
        tx({ amount: 5000, category: 'Salary' }),
        tx({ amount: -3000, category: 'Investments' }),
        tx({ amount: 1000, category: 'Investments' }),
      ],
      KINDS,
    )
    expect(r.totals.expenses).toBe(0)
    expect(r.totals.income).toBe(5000)
    expect(r.totals.invested).toBe(3000)
    expect(r.totals.redeemed).toBe(1000)
    expect(r.netSaved).toBe(2000)
  })

  it('estorno no cartão reduz o gasto em vez de virar receita', () => {
    const { totals } = cashFlow(
      [
        tx({ amount: -500, accountId: 'cartao', category: 'Shopping' }),
        tx({ amount: 200, accountId: 'cartao', category: 'Shopping' }),
      ],
      KINDS,
    )
    expect(totals.expenses).toBe(300)
    expect(totals.income).toBe(0)
  })

  it('expõe o gasto de cartão sem lançamento em vez de fazê-lo evaporar', () => {
    // Fatura de 3000 paga, mas só 800 de compras no histórico: os outros 2200
    // saíram da conta de verdade e não têm lançamento correspondente.
    const r = cashFlow(
      [
        tx({ amount: 10000, category: 'Salary' }),
        tx({ amount: -800, accountId: 'cartao', category: 'Shopping' }),
        tx({ amount: -3000, accountId: 'conta', category: 'Credit card payment' }),
      ],
      KINDS,
    )
    expect(r.cardCoverage.billPaid).toBe(3000)
    expect(r.cardCoverage.purchasesRecorded).toBe(800)
    expect(r.cardCoverage.unrecorded).toBe(2200)

    expect(r.totals.expenses).toBe(800) // o que os lançamentos mostram
    expect(r.expensesAdjusted).toBe(3000) // o que de fato saiu
    expect(r.netAdjusted).toBe(7000) // e não 9200
  })

  it('histórico de cartão completo não gera ajuste', () => {
    const r = cashFlow(
      [
        tx({ amount: 5000, category: 'Salary' }),
        tx({ amount: -800, accountId: 'cartao', category: 'Shopping' }),
        tx({ amount: -800, accountId: 'conta', category: 'Credit card payment' }),
      ],
      KINDS,
    )
    expect(r.cardCoverage.unrecorded).toBe(0)
    expect(r.expensesAdjusted).toBe(r.totals.expenses)
    expect(r.netAdjusted).toBe(r.totals.net)
  })

  it('mais compras que fatura paga não vira ajuste negativo', () => {
    // Fatura ainda em aberto: comprou mais do que pagou. Não há gasto oculto.
    const r = cashFlow(
      [
        tx({ amount: 5000, category: 'Salary' }),
        tx({ amount: -2000, accountId: 'cartao', category: 'Shopping' }),
        tx({ amount: -500, accountId: 'conta', category: 'Credit card payment' }),
      ],
      KINDS,
    )
    expect(r.cardCoverage.unrecorded).toBe(0)
  })

  it('agrupa por mês em ordem cronológica', () => {
    const { months } = cashFlow(
      [
        tx({ date: '2026-06-10', amount: 5000, category: 'Salary' }),
        tx({ date: '2026-05-10', amount: 4000, category: 'Salary' }),
        tx({ date: '2026-06-20', amount: -1000, category: 'Groceries' }),
      ],
      KINDS,
    )
    expect(months.map((m) => m.month)).toEqual(['2026-05', '2026-06'])
    expect(months[1]!.net).toBe(4000)
  })

  it('mês no vermelho reporta líquido negativo', () => {
    const { months } = cashFlow(
      [
        tx({ amount: 3000, category: 'Salary' }),
        tx({ amount: -4500, category: 'Shopping' }),
      ],
      KINDS,
    )
    expect(months[0]!.net).toBe(-1500)
  })
})
